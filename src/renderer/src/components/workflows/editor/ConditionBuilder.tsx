import React, { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { Condition } from '../../../../../shared/workflows/workflow-definition-types'
import {
  CONDITION_COMBINATORS,
  CONDITION_OPS,
  conditionOpNeedsValue,
  decodeCondition,
  encodeConditionBuilderState,
  type ConditionBuilderRow,
  type ConditionBuilderState,
  type ConditionOp
} from './workflow-condition-builder-state'

export type ConditionBuilderProps = {
  condition: Condition | undefined
  onChange: (condition: Condition | undefined) => void
}

/** Content comparison (not `===`) so our own committed edit — a new-but-equal object round-
 *  tripping back through props — is never mistaken for an external change. */
function conditionsMatch(a: Condition | undefined, b: Condition | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function generateRowKeys(count: number): string[] {
  return Array.from({ length: count }, () => createBrowserUuid())
}

function conditionOpLabel(op: ConditionOp): string {
  switch (op) {
    case 'eq':
      return translate('auto.components.workflows.editor.ConditionBuilder.opEq', 'equals')
    case 'neq':
      return translate('auto.components.workflows.editor.ConditionBuilder.opNeq', 'not equals')
    case 'gt':
      return translate('auto.components.workflows.editor.ConditionBuilder.opGt', 'greater than')
    case 'gte':
      return translate(
        'auto.components.workflows.editor.ConditionBuilder.opGte',
        'greater than or equal'
      )
    case 'lt':
      return translate('auto.components.workflows.editor.ConditionBuilder.opLt', 'less than')
    case 'lte':
      return translate(
        'auto.components.workflows.editor.ConditionBuilder.opLte',
        'less than or equal'
      )
    case 'truthy':
      return translate('auto.components.workflows.editor.ConditionBuilder.opTruthy', 'is truthy')
    case 'falsy':
      return translate('auto.components.workflows.editor.ConditionBuilder.opFalsy', 'is falsy')
    case 'contains':
      return translate('auto.components.workflows.editor.ConditionBuilder.opContains', 'contains')
    case 'lengthGt':
      return translate(
        'auto.components.workflows.editor.ConditionBuilder.opLengthGt',
        'length greater than'
      )
  }
}

function ConditionRow({
  row,
  onChange,
  onRemove
}: {
  row: ConditionBuilderRow
  onChange: (row: ConditionBuilderRow) => void
  onRemove: () => void
}): React.JSX.Element {
  const needsValue = conditionOpNeedsValue(row.op)
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={row.path}
        onChange={(event) => onChange({ ...row, path: event.target.value })}
        placeholder={translate(
          'auto.components.workflows.editor.ConditionBuilder.pathPlaceholder',
          'result path (e.g. approved)'
        )}
        className="h-8 min-w-0 flex-1"
        aria-label={translate(
          'auto.components.workflows.editor.ConditionBuilder.pathLabel',
          'Result path'
        )}
      />
      <Select
        value={row.op}
        onValueChange={(value) => {
          const op = CONDITION_OPS.find((candidate) => candidate === value)
          if (op) {
            onChange({ ...row, op })
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className="shrink-0"
          aria-label={translate(
            'auto.components.workflows.editor.ConditionBuilder.opLabel',
            'Comparison'
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONDITION_OPS.map((op) => (
            <SelectItem key={op} value={op}>
              {conditionOpLabel(op)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {needsValue ? (
        <Input
          value={row.value}
          onChange={(event) => onChange({ ...row, value: event.target.value })}
          placeholder={translate(
            'auto.components.workflows.editor.ConditionBuilder.valuePlaceholder',
            'value'
          )}
          className="h-8 min-w-0 flex-1"
          aria-label={translate(
            'auto.components.workflows.editor.ConditionBuilder.valueLabel',
            'Comparison value'
          )}
        />
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        aria-label={translate(
          'auto.components.workflows.editor.ConditionBuilder.removeRow',
          'Remove condition'
        )}
      >
        <X />
      </Button>
    </div>
  )
}

/** Edits an Edge's `Condition` (data-model.md `Condition`): a flat list of leaf comparisons
 *  joined by all/any, optionally negated. FR-008: an edge with no rows always fires. */
export default function ConditionBuilder({
  condition,
  onChange
}: ConditionBuilderProps): React.JSX.Element {
  const [state, setState] = useState<ConditionBuilderState>(() => decodeCondition(condition))
  // The `condition` value `state` currently reflects — either the initial prop, or the last
  // value we ourselves committed. Compared by content, not identity, below.
  const [syncedCondition, setSyncedCondition] = useState(condition)
  // Why: rows have no id of their own; a stable per-row key keeps a row's inputs attached to
  // that row when a different row is removed, instead of the array index.
  const [rowKeys, setRowKeys] = useState<string[]>(() => generateRowKeys(state.rows.length))

  // Resync when `condition` changes without going through `commit` below — e.g. undo/redo or
  // another client editing the same edge while it stays selected. A no-op for our own edits,
  // which update `syncedCondition` in lockstep, and never fires mid-typing since every row
  // interaction here already commits (there is no "invalid, uncommitted" condition draft).
  if (!conditionsMatch(condition, syncedCondition)) {
    const nextState = decodeCondition(condition)
    setSyncedCondition(condition)
    setState(nextState)
    setRowKeys(generateRowKeys(nextState.rows.length))
  }

  const keyedRows = state.rows.map((row, index) => ({
    rowKey: rowKeys[index] ?? createBrowserUuid(),
    row,
    index
  }))

  function commit(next: ConditionBuilderState): void {
    const encoded = encodeConditionBuilderState(next)
    setState(next)
    setSyncedCondition(encoded)
    onChange(encoded)
  }

  function updateRow(index: number, row: ConditionBuilderRow): void {
    commit({
      ...state,
      rows: state.rows.map((r, i) => (i === index ? row : r)),
      unsupported: false
    })
  }

  function removeRow(index: number): void {
    setRowKeys((keys) => keys.filter((_, i) => i !== index))
    commit({ ...state, rows: state.rows.filter((_, i) => i !== index), unsupported: false })
  }

  function addRow(): void {
    setRowKeys((keys) => [...keys, createBrowserUuid()])
    commit({
      ...state,
      rows: [...state.rows, { path: '', op: 'truthy', value: '' }],
      unsupported: false
    })
  }

  return (
    <div className="space-y-2">
      {state.unsupported ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.editor.ConditionBuilder.unsupportedShape',
            "This edge's condition can't be shown here; adding a condition below replaces it."
          )}
        </p>
      ) : null}
      {state.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.editor.ConditionBuilder.unconditioned',
            'No condition — this edge always fires.'
          )}
        </p>
      ) : (
        <div className="space-y-1.5">
          {keyedRows.map(({ rowKey, row, index }) => (
            <ConditionRow
              key={rowKey}
              row={row}
              onChange={(next) => updateRow(index, next)}
              onRemove={() => removeRow(index)}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus />
          {translate('auto.components.workflows.editor.ConditionBuilder.addRow', 'Add condition')}
        </Button>
        {state.rows.length > 1 ? (
          <Select
            value={state.combinator}
            onValueChange={(value) => {
              const combinator = CONDITION_COMBINATORS.find((candidate) => candidate === value)
              if (combinator) {
                commit({ ...state, combinator })
              }
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {translate(
                  'auto.components.workflows.editor.ConditionBuilder.matchAll',
                  'Match all'
                )}
              </SelectItem>
              <SelectItem value="any">
                {translate(
                  'auto.components.workflows.editor.ConditionBuilder.matchAny',
                  'Match any'
                )}
              </SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {state.rows.length > 0 ? (
        <Label>
          <Checkbox
            checked={state.negate}
            onCheckedChange={(checked) => commit({ ...state, negate: checked === true })}
          />
          {translate('auto.components.workflows.editor.ConditionBuilder.negate', 'Negate (NOT)')}
        </Label>
      ) : null}
    </div>
  )
}
