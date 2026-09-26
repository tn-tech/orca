import type {
  Condition,
  JsonValue
} from '../../../../../shared/workflows/workflow-definition-types'

type ConditionLeaf = Extract<Condition, { path: string }>
export type ConditionOp = ConditionLeaf['op']

export const CONDITION_OPS: readonly ConditionOp[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'truthy',
  'falsy',
  'contains',
  'lengthGt'
]

/** Ops that read the path alone; every other op compares it against `value`. */
export function conditionOpNeedsValue(op: ConditionOp): boolean {
  return op !== 'truthy' && op !== 'falsy'
}

export type ConditionBuilderRow = { path: string; op: ConditionOp; value: string }

export const CONDITION_COMBINATORS = ['all', 'any'] as const
export type ConditionCombinator = (typeof CONDITION_COMBINATORS)[number]

export type ConditionBuilderState = {
  rows: ConditionBuilderRow[]
  combinator: ConditionCombinator
  negate: boolean
  /** True when the incoming Condition had a shape this flat builder can't represent (deeper
   *  nesting than one combinator over leaves); editing here replaces it instead of round-tripping. */
  unsupported: boolean
}

export const EMPTY_CONDITION_BUILDER_STATE: ConditionBuilderState = {
  rows: [],
  combinator: 'all',
  negate: false,
  unsupported: false
}

/** Best-effort JSON literal parse for a typed operand; falls back to the raw string. */
export function parseConditionValue(text: string): JsonValue {
  const trimmed = text.trim()
  if (trimmed === '') {
    return ''
  }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isJsonValue(parsed) ? parsed : text
  } catch {
    return text
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    Array.isArray(value) ||
    typeof value === 'object'
  )
}

export function stringifyConditionValue(value: JsonValue | undefined): string {
  if (value === undefined) {
    return ''
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function isLeaf(condition: Condition): condition is ConditionLeaf {
  return 'path' in condition
}

function leafToRow(leaf: ConditionLeaf): ConditionBuilderRow {
  return {
    path: leaf.path,
    op: leaf.op,
    value: conditionOpNeedsValue(leaf.op) ? stringifyConditionValue(leaf.value) : ''
  }
}

function toLeafCondition(row: ConditionBuilderRow): ConditionLeaf {
  return conditionOpNeedsValue(row.op)
    ? { path: row.path, op: row.op, value: parseConditionValue(row.value) }
    : { path: row.path, op: row.op }
}

function decodeBody(
  condition: Condition
): Pick<ConditionBuilderState, 'rows' | 'combinator'> | undefined {
  if (isLeaf(condition)) {
    return { rows: [leafToRow(condition)], combinator: 'all' }
  }
  if ('all' in condition && condition.all.every(isLeaf)) {
    return { rows: condition.all.map(leafToRow), combinator: 'all' }
  }
  if ('any' in condition && condition.any.every(isLeaf)) {
    return { rows: condition.any.map(leafToRow), combinator: 'any' }
  }
  return undefined
}

/** Decodes an edge's `Condition` into builder rows (data-model.md `Condition`); a shape deeper
 *  than one combinator over leaves is flagged `unsupported` rather than guessed at. */
export function decodeCondition(condition: Condition | undefined): ConditionBuilderState {
  if (condition === undefined) {
    return EMPTY_CONDITION_BUILDER_STATE
  }
  const negate = 'not' in condition
  const body = decodeBody(negate ? condition.not : condition)
  if (!body) {
    return { rows: [], combinator: 'all', negate, unsupported: true }
  }
  return { ...body, negate, unsupported: false }
}

/** Encodes builder rows back into a `Condition`; `undefined` means the edge is unconditioned. */
export function encodeConditionBuilderState(state: ConditionBuilderState): Condition | undefined {
  const leaves = state.rows
    .filter((row) => row.path.trim() !== '')
    .map((row) => toLeafCondition(row))
  if (leaves.length === 0) {
    return undefined
  }
  const body: Condition =
    leaves.length === 1 ? leaves[0] : state.combinator === 'all' ? { all: leaves } : { any: leaves }
  return state.negate ? { not: body } : body
}
