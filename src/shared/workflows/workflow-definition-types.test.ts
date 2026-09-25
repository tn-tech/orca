import { describe, expect, it } from 'vitest'
import { ConditionSchema } from './workflow-condition-schema'
import type { Condition, Node, NodeBase } from './workflow-definition-types'
import { NodeSchema } from './workflow-node-schemas'

const MINIMAL_NODES_BY_TYPE: Record<Node['type'], unknown> = {
  start: { id: 's', type: 'start', title: 'Start' },
  end: { id: 'e', type: 'end', title: 'End' },
  agent: {
    id: 'a',
    type: 'agent',
    title: 'Agent',
    prompt: 'do the thing',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 1, escalationGraceMs: 1 }
  },
  router: { id: 'r', type: 'router', title: 'Router', prompt: 'choose', choices: ['a', 'b'] },
  loop: {
    id: 'l',
    type: 'loop',
    title: 'Loop',
    body: { nodeIds: ['x'] },
    entryNodeId: 'x',
    exitNodeId: 'x',
    maxIterations: 1,
    exitCondition: { path: 'approved', op: 'truthy' },
    onCapReached: 'fail'
  },
  join: { id: 'j', type: 'join', title: 'Join', policy: 'all', onFailure: 'fail' },
  approval: {
    id: 'ap',
    type: 'approval',
    title: 'Approval',
    question: 'Approve?',
    options: ['yes', 'no'],
    timeoutMs: 1,
    escalationGraceMs: 1
  },
  reflection: { id: 'rf', type: 'reflection', title: 'Reflection', prompt: 'reflect' }
}

/** Exhaustive switch, no default: `typescript/switch-exhaustiveness-check` fails `pnpm lint` if
 *  a Node variant is added or removed without updating this. */
function describeNodeType(node: Node): string {
  switch (node.type) {
    case 'start':
      return 'start'
    case 'end':
      return 'end'
    case 'agent':
      return 'agent'
    case 'router':
      return 'router'
    case 'loop':
      return 'loop'
    case 'join':
      return 'join'
    case 'approval':
      return 'approval'
    case 'reflection':
      return 'reflection'
  }
}

describe('Node discriminated union', () => {
  it('covers exactly start|end|agent|router|loop|join|approval|reflection', () => {
    const types = Object.keys(MINIMAL_NODES_BY_TYPE)
    expect(types.sort()).toEqual(
      ['agent', 'approval', 'end', 'join', 'loop', 'reflection', 'router', 'start'].sort()
    )
    for (const [type, raw] of Object.entries(MINIMAL_NODES_BY_TYPE)) {
      const parsed = NodeSchema.parse(raw)
      expect(parsed.type).toBe(type)
      expect(describeNodeType(parsed)).toBe(type)
    }
  })

  it('rejects a node type outside the eight documented variants', () => {
    const result = NodeSchema.safeParse({ id: 'x', type: 'bogus', title: 'Bogus' })
    expect(result.success).toBe(false)
  })

  it('NodeBase fields (id, type, title, notes?) type-check against the union discriminant', () => {
    const base: NodeBase = { id: 'n1', type: 'agent', title: 'A node' }
    expect(base.notes).toBeUndefined()
  })
})

describe('Condition all|any|not nesting', () => {
  it('accepts a leaf condition nested under all/any/not combinators', () => {
    const nested: Condition = {
      all: [
        { path: 'approved', op: 'truthy' },
        {
          any: [
            { not: { path: 'score', op: 'lt', value: 3 } },
            { path: 'override', op: 'eq', value: true }
          ]
        }
      ]
    }
    expect(ConditionSchema.parse(nested)).toEqual(nested)
  })

  it('rejects a leaf field mixed onto a combinator object', () => {
    const invalid = { all: [{ path: 'x', op: 'truthy' }], path: 'y', op: 'truthy' }
    expect(ConditionSchema.safeParse(invalid).success).toBe(false)
  })
})
