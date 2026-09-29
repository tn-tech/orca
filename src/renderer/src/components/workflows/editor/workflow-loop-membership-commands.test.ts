import { describe, expect, it } from 'vitest'
import type {
  AgentNode,
  ApprovalNode,
  Edge,
  JoinNode,
  LoopNode,
  Node,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { validateWorkflowGraph } from '../../../../../shared/workflows/workflow-graph-validation'
import {
  createInitialWorkflowEditorState,
  workflowEditorReducer
} from './use-workflow-editor-state'
import { computeLoopContainerBounds, WORKFLOW_LOOP_PADDING } from './workflow-auto-layout'
import { editLoopInDefinition, loopMemberCandidates } from './workflow-loop-membership-commands'

function agent(id: string): AgentNode {
  return {
    id,
    type: 'agent',
    title: id,
    prompt: 'go',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 600_000, escalationGraceMs: 300_000 }
  }
}

function approval(id: string, options = ['ok', 'redo']): ApprovalNode {
  return {
    id,
    type: 'approval',
    title: id,
    question: 'Continue?',
    options,
    timeoutMs: 600_000,
    escalationGraceMs: 300_000
  }
}

function join(id: string): JoinNode {
  return { id, type: 'join', title: id, policy: 'any', onFailure: 'fail' }
}

function loop(patch: Partial<LoopNode> = {}): LoopNode {
  return {
    id: 'loop',
    type: 'loop',
    title: 'Loop',
    body: { nodeIds: ['a', 'b'] },
    entryNodeId: 'a',
    exitNodeId: 'b',
    maxIterations: 3,
    exitCondition: { path: 'approved', op: 'truthy' },
    onCapReached: 'fail',
    ...patch
  }
}

/** Start -> Loop[a -> b] -exit-> End, plus whatever `extraNodes`/`extraEdges` add. */
function workflow(extraNodes: Node[] = [], extraEdges: Edge[] = [], loopPatch = {}): Workflow {
  return {
    version: 1,
    name: 'test',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      loop(loopPatch),
      agent('a'),
      agent('b'),
      { id: 'end', type: 'end', title: 'End' },
      ...extraNodes
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'loop' },
      { id: 'e2', from: 'a', to: 'b' },
      { id: 'e3', from: 'b', to: 'end', fromPort: 'exit' },
      ...extraEdges
    ],
    layout: {
      start: { x: 0, y: -200 },
      loop: { x: 0, y: 0 },
      a: { x: 40, y: 40 },
      b: { x: 300, y: 40 },
      end: { x: 0, y: 400 },
      approval: { x: 900, y: 900 },
      join: { x: 1200, y: 900 },
      loose: { x: 1500, y: 900 }
    }
  }
}

function loopOf(definition: Workflow): LoopNode {
  const found = definition.nodes.find((node): node is LoopNode => node.type === 'loop')
  if (!found) {
    throw new Error('expected a Loop node')
  }
  return found
}

function edited(definition: Workflow, edit: Parameters<typeof editLoopInDefinition>[2]): Workflow {
  const result = editLoopInDefinition(definition, 'loop', edit)
  if (!result.ok) {
    throw new Error(`expected the edit to succeed: ${result.problem.message}`)
  }
  return result.definition
}

function problemCodes(definition: Workflow): string[] {
  return (
    validateWorkflowGraph(definition, {
      agentSupportsModel: () => true,
      allowlistedSources: []
    })
      // Role-less fixture agents are beside the point here.
      .filter((problem) => problem.severity === 'error' && problem.code !== 'graph_node_unassigned')
      .map((problem) => problem.code)
  )
}

describe('editLoopInDefinition: entry and exit', () => {
  it('points the entry at another body member', () => {
    expect(loopOf(edited(workflow(), { kind: 'set-entry', nodeId: 'b' })).entryNodeId).toBe('b')
  })

  it('moves the exit and re-homes body-sourced exit edges onto the Loop itself', () => {
    const next = edited(workflow(), { kind: 'set-exit', nodeId: 'a' })
    expect(loopOf(next).exitNodeId).toBe('a')
    expect(next.edges.find((edge) => edge.id === 'e3')).toEqual({
      id: 'e3',
      from: 'loop',
      to: 'end',
      fromPort: 'exit'
    })
  })

  it('refuses an entry or exit that is not in the body, without changing anything', () => {
    const definition = workflow()
    for (const kind of ['set-entry', 'set-exit'] as const) {
      const result = editLoopInDefinition(definition, 'loop', { kind, nodeId: 'end' })
      expect(result.ok).toBe(false)
    }
  })

  it('refuses when the target is not a Loop', () => {
    const result = editLoopInDefinition(workflow(), 'a', { kind: 'set-entry', nodeId: 'a' })
    expect(result).toMatchObject({ ok: false, problem: { code: 'workflow_editor_loop_not_found' } })
  })
})

describe('editLoopInDefinition: adding members', () => {
  it('adds an Approval to the body inside the container, and the graph still validates', () => {
    const next = edited(
      workflow([approval('approval')], [{ id: 'e4', from: 'b', to: 'approval' }]),
      {
        kind: 'add-member',
        nodeId: 'approval'
      }
    )
    expect(loopOf(next).body.nodeIds).toEqual(['a', 'b', 'approval'])
    // Placed to the right of the existing members, on the body's top row.
    expect(next.layout.approval).toEqual({ x: 300 + 220 + WORKFLOW_LOOP_PADDING, y: 40 })
    const withExit = edited(next, { kind: 'set-exit', nodeId: 'approval' })
    expect(problemCodes(withExit)).toEqual([])
  })

  it('adds Router and Join nodes too', () => {
    const router: Node = {
      id: 'loose',
      type: 'router',
      title: 'route',
      prompt: 'pick',
      choices: ['x']
    }
    expect(
      loopOf(edited(workflow([router]), { kind: 'add-member', nodeId: 'loose' })).body.nodeIds
    ).toContain('loose')
    expect(
      loopOf(edited(workflow([join('join')]), { kind: 'add-member', nodeId: 'join' })).body.nodeIds
    ).toContain('join')
  })

  it('refuses Start, End, a Loop, an existing member, and a node wired to the Loop itself', () => {
    const definition = workflow([agent('loose')], [{ id: 'e5', from: 'loose', to: 'loop' }])
    for (const nodeId of ['start', 'end', 'loop', 'a', 'loose', 'missing']) {
      expect(editLoopInDefinition(definition, 'loop', { kind: 'add-member', nodeId }).ok).toBe(
        false
      )
    }
  })

  it('refuses a node already inside another Loop', () => {
    const other = loop({ id: 'other', body: { nodeIds: ['loose'] }, entryNodeId: 'loose' })
    const definition = workflow([agent('loose'), { ...other, exitNodeId: 'loose' }])
    const result = editLoopInDefinition(definition, 'loop', { kind: 'add-member', nodeId: 'loose' })
    expect(result.ok).toBe(false)
  })
})

describe('editLoopInDefinition: removing members', () => {
  it('removes a middle member, re-homes its exit edges, and moves it clear of the container', () => {
    const definition = workflow(
      [agent('c')],
      [
        { id: 'e4', from: 'b', to: 'c' },
        { id: 'e5', from: 'c', to: 'end', fromPort: 'exit' }
      ],
      { body: { nodeIds: ['a', 'c', 'b'] } }
    )
    definition.layout.c = { x: 600, y: 40 }
    const next = edited(definition, { kind: 'remove-member', nodeId: 'c' })
    expect(loopOf(next).body.nodeIds).toEqual(['a', 'b'])
    expect(next.edges.find((edge) => edge.id === 'e5')).toMatchObject({
      from: 'loop',
      fromPort: 'exit'
    })
    const bounds = computeLoopContainerBounds(next.layout.loop, [next.layout.a, next.layout.b])
    expect(next.layout.c.x).toBeGreaterThanOrEqual(next.layout.loop.x + bounds.width)
  })

  it('refuses to remove the entry, the exit, or a non-member', () => {
    for (const nodeId of ['a', 'b', 'end']) {
      expect(editLoopInDefinition(workflow(), 'loop', { kind: 'remove-member', nodeId }).ok).toBe(
        false
      )
    }
  })
})

describe('loopMemberCandidates', () => {
  it('lists every loose node kind the engine runs inside a Loop', () => {
    const definition = workflow(
      [approval('approval'), join('join'), agent('loose')],
      [{ id: 'e6', from: 'loop', to: 'loose', fromPort: 'exit' }]
    )
    expect(loopMemberCandidates(definition, 'loop').map((node) => node.id)).toEqual([
      'approval',
      'join'
    ])
  })
})

describe('workflow editor state: edit-loop', () => {
  it('commits an edit as one undoable step and surfaces a refusal as lastProblem', () => {
    let state = createInitialWorkflowEditorState(workflow())
    state = workflowEditorReducer(state, {
      type: 'edit-loop',
      loopId: 'loop',
      edit: { kind: 'set-entry', nodeId: 'b' }
    })
    expect(loopOf(state.definition).entryNodeId).toBe('b')
    expect(state.history).toHaveLength(1)

    state = workflowEditorReducer(state, {
      type: 'edit-loop',
      loopId: 'loop',
      edit: { kind: 'remove-member', nodeId: 'b' }
    })
    expect(state.lastProblem?.code).toBe('workflow_editor_loop_remove_endpoint')
    expect(state.history).toHaveLength(1)
  })
})
