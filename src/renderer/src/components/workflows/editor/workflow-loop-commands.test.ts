import { describe, expect, it } from 'vitest'
import type {
  Edge,
  Node,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { measureWorkflowNodeSize, WORKFLOW_LOOP_PADDING } from './workflow-auto-layout'
import { wrapNodesInLoopInDefinition } from './workflow-loop-commands'

function agentNode(id: string): Node {
  return {
    id,
    type: 'agent',
    title: id,
    prompt: 'do the thing',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 1, escalationGraceMs: 1 }
  }
}

function workflow(nodes: Node[], edges: Edge[], layout: Workflow['layout']): Workflow {
  return {
    version: 1,
    name: 'test',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes,
    edges,
    layout
  }
}

describe('wrapNodesInLoopInDefinition', () => {
  it('does not overlap a neighbour left closer than WORKFLOW_LOOP_PADDING to the wrapped selection (F10 round 1 review, Important #4)', () => {
    const a = agentNode('a')
    const sibling = agentNode('sibling')
    const definition = workflow([a, sibling], [], {
      // Only 20px below "a"'s bottom edge — inside the 40px padding the Loop frame needs.
      a: { x: 0, y: 0 },
      sibling: { x: 0, y: measureWorkflowNodeSize(a).height + 20 }
    })

    const result = wrapNodesInLoopInDefinition(definition, ['a'])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const loopId = result.definition.nodes.find((node) => node.type === 'loop')?.id
    expect(loopId).toBeDefined()
    if (!loopId) {
      return
    }
    const loopPosition = result.definition.layout[loopId]
    const loopBottom =
      loopPosition.y + measureWorkflowNodeSize(a).height + WORKFLOW_LOOP_PADDING * 2
    const siblingPosition = result.definition.layout.sibling
    expect(siblingPosition.y).toBeGreaterThanOrEqual(loopBottom)
  })

  it('leaves a neighbour untouched when it is nowhere near the wrapped selection', () => {
    const a = agentNode('a')
    const sibling = agentNode('sibling')
    const definition = workflow([a, sibling], [], {
      a: { x: 0, y: 0 },
      sibling: { x: 2000, y: 2000 }
    })

    const result = wrapNodesInLoopInDefinition(definition, ['a'])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.definition.layout.sibling).toEqual({ x: 2000, y: 2000 })
    }
  })

  it('wraps every node kind the engine runs inside a Loop (US5 AS4: an Approval in a Loop)', () => {
    const kinds: Node[] = [
      {
        id: 'approval',
        type: 'approval',
        title: 'Check',
        question: 'Continue?',
        options: ['ok'],
        timeoutMs: 1,
        escalationGraceMs: 1
      },
      { id: 'router', type: 'router', title: 'Route', prompt: 'pick', choices: ['x'] },
      { id: 'join', type: 'join', title: 'Join', policy: 'all', onFailure: 'fail' },
      { id: 'reflection', type: 'reflection', title: 'Reflect', prompt: 'think' }
    ]
    for (const node of kinds) {
      const result = wrapNodesInLoopInDefinition(
        workflow([node], [], { [node.id]: { x: 0, y: 0 } }),
        [node.id]
      )
      expect(result.ok).toBe(true)
    }
  })

  it('refuses Start, End and Loop nodes', () => {
    const nodes: Node[] = [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'end', type: 'end', title: 'End' }
    ]
    for (const node of nodes) {
      const result = wrapNodesInLoopInDefinition(workflow([node], [], {}), [node.id])
      expect(result).toMatchObject({
        ok: false,
        problem: { code: 'workflow_editor_wrap_unwrappable_node' }
      })
    }
  })

  it('refuses an Approval whose option edge would have to leave the Loop', () => {
    const gate: Node = {
      id: 'gate',
      type: 'approval',
      title: 'Gate',
      question: 'Ship?',
      options: ['yes'],
      timeoutMs: 1,
      escalationGraceMs: 1
    }
    const definition = workflow(
      [gate, agentNode('after')],
      [{ id: 'e1', from: 'gate', to: 'after', fromPort: 'yes' }],
      {}
    )
    expect(wrapNodesInLoopInDefinition(definition, ['gate'])).toMatchObject({
      ok: false,
      problem: {
        code: 'workflow_editor_wrap_ported_exit',
        message:
          'The "yes" option of Gate leads out of the Loop to after. Delete that edge, or wrap after as well.'
      }
    })
  })
})
