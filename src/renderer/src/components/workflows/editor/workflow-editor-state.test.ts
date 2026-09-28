// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type {
  AgentNode,
  EndNode,
  LoopNode,
  ReflectionNode,
  Role,
  StartNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import {
  validateWorkflowGraph,
  type GraphValidationContext
} from '../../../../../shared/workflows/workflow-graph-validation'
import {
  createInitialWorkflowEditorState,
  workflowEditorReducer,
  type WorkflowEditorAction,
  type WorkflowEditorState
} from './use-workflow-editor-state'
import {
  getModelEffortAvailability,
  type WorkflowEditorCommandContext
} from './workflow-editor-commands'
import { unwrapLoopInDefinition } from './workflow-loop-unwrap-command'

const permissiveContext: GraphValidationContext = {
  agentSupportsModel: () => true,
  allowlistedSources: []
}

const editorContext: WorkflowEditorCommandContext = {
  agentSupportsModel: (agent) => agent === 'claude'
}

function role(patch: Partial<Role> = {}): Role {
  return {
    id: 'dev',
    name: 'Dev',
    agent: 'claude',
    systemPrompt: 'Do the work.',
    skills: [],
    ...patch
  }
}

function startNode(id = 'start'): StartNode {
  return { id, type: 'start', title: 'Start' }
}

function endNode(id = 'end'): EndNode {
  return { id, type: 'end', title: 'End' }
}

function agentNode(id: string, patch: Partial<AgentNode> = {}): AgentNode {
  return {
    id,
    type: 'agent',
    title: id,
    prompt: 'go',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 600_000, escalationGraceMs: 300_000 },
    ...patch
  }
}

function reflectionNode(id: string, patch: Partial<ReflectionNode> = {}): ReflectionNode {
  return { id, type: 'reflection', title: id, prompt: 'Reflect on the run.', ...patch }
}

function loopNode(id: string, patch: Partial<LoopNode> = {}): LoopNode {
  return {
    id,
    type: 'loop',
    title: id,
    body: { nodeIds: ['work'] },
    entryNodeId: 'work',
    exitNodeId: 'work',
    maxIterations: 3,
    exitCondition: { path: 'approved', op: 'truthy' },
    onCapReached: 'fail',
    ...patch
  }
}

function emptyWorkflow(): Workflow {
  return {
    version: 1,
    name: 'test-workflow',
    workspacePolicy: 'run-workspace',
    roles: { dev: role() },
    nodes: [],
    edges: [],
    layout: {}
  }
}

function dispatch(state: WorkflowEditorState, action: WorkflowEditorAction): WorkflowEditorState {
  return workflowEditorReducer(state, action)
}

describe('workflow editor state: add node, connect nodes', () => {
  it('adds a node, marking the editor dirty and bumping the revision', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())

    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })

    expect(state.definition.nodes).toEqual([startNode()])
    expect(state.definition.layout.start).toEqual({ x: 0, y: 0 })
    expect(state.dirty).toBe(true)
    expect(state.revision).toBe(1)
  })

  it('connects two nodes with a new edge', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 200, y: 0 } })

    state = dispatch(state, { type: 'connect', from: 'start', to: 'end' })

    expect(state.definition.edges).toHaveLength(1)
    expect(state.definition.edges[0]).toMatchObject({ from: 'start', to: 'end' })
  })

  it('adds a Reflection node the same way as any other role-dispatching node (review round 1 fold-in)', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: reflectionNode('reflect', { roleId: 'dev' }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 400, y: 0 } })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'reflect' })
    state = dispatch(state, { type: 'connect', from: 'reflect', to: 'end' })

    expect(state.definition.nodes).toContainEqual(reflectionNode('reflect', { roleId: 'dev' }))
    expect(state.definition.layout.reflect).toEqual({ x: 200, y: 0 })
    expect(validateWorkflowGraph(state.definition, permissiveContext)).toEqual([])
  })

  it('refuses a connection that would close a cycle outside a Loop node', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('a', { overrides: { agent: 'claude' } }),
      position: { x: 0, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('b', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'connect', from: 'a', to: 'b' })
    const edgeCountBeforeRefusal = state.definition.edges.length

    state = dispatch(state, { type: 'connect', from: 'b', to: 'a' })

    expect(state.definition.edges).toHaveLength(edgeCountBeforeRefusal)
    expect(state.lastProblem?.code).toBe('graph_cycle')
  })
})

describe('workflow editor state: edit agent, model and effort', () => {
  it('replaces a node with updated agent/model/effort overrides', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    const original = agentNode('work', { overrides: { agent: 'claude' } })
    state = dispatch(state, { type: 'add-node', node: original, position: { x: 0, y: 0 } })

    state = dispatch(state, {
      type: 'update-node',
      node: { ...original, overrides: { agent: 'claude', model: 'opus', effort: 'high' } }
    })

    expect(state.definition.nodes.find((node) => node.id === 'work')).toMatchObject({
      overrides: { agent: 'claude', model: 'opus', effort: 'high' }
    })
  })

  it('refuses to update a node id that is not in the definition', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())

    state = dispatch(state, { type: 'update-node', node: agentNode('missing') })

    expect(state.lastProblem?.code).toBe('workflow_editor_node_not_found')
    expect(state.dirty).toBe(false)
  })

  it('disables model and effort controls for an agent without a model catalog', () => {
    expect(getModelEffortAvailability('claude', editorContext)).toEqual({ enabled: true })

    const unsupported = getModelEffortAvailability('some-custom-agent', editorContext)
    expect(unsupported.enabled).toBe(false)
    expect(unsupported.reason).toBeTruthy()

    const noAgent = getModelEffortAvailability(undefined, editorContext)
    expect(noAgent.enabled).toBe(false)
    expect(noAgent.reason).toBeTruthy()
  })
})

describe('workflow editor state: save', () => {
  it('produces a definition that passes validateWorkflowGraph', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('work', { roleId: 'dev' }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 400, y: 0 } })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'work' })
    state = dispatch(state, { type: 'connect', from: 'work', to: 'end' })

    const problems = validateWorkflowGraph(state.definition, permissiveContext)

    expect(problems).toEqual([])
  })
})

describe('workflow editor state: layout survives a run-snapshot refresh', () => {
  it('keeps a manually dragged node fixed, while untouched nodes follow Re-layout', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('work', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 400, y: 0 } })
    state = dispatch(state, { type: 'move-node', nodeId: 'work', position: { x: 555, y: 777 } })
    expect(state.definition.layout.work).toEqual({ x: 555, y: 777 })

    // Simulate a run-snapshot refresh: the same graph, with different (e.g. stale) positions.
    const refreshed: Workflow = {
      ...state.definition,
      layout: {
        start: { x: 10, y: 10 },
        work: { x: 10, y: 10 },
        end: { x: 10, y: 10 }
      }
    }
    state = dispatch(state, { type: 'load-definition', definition: refreshed })

    expect(state.definition.layout.work).toEqual({ x: 555, y: 777 })
    expect(state.definition.layout.start).toEqual({ x: 10, y: 10 })
    expect(state.dirty).toBe(false)

    state = dispatch(state, { type: 'auto-layout' })

    expect(state.definition.layout.work).toEqual({ x: 555, y: 777 })
    expect(state.definition.layout.start).not.toEqual({ x: 10, y: 10 })
  })
})

describe('workflow editor state: edge conditions', () => {
  it('round-trips an edge condition edited through the condition builder', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('a', { overrides: { agent: 'claude' } }),
      position: { x: 0, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('b', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'connect', from: 'a', to: 'b' })
    const edgeId = state.definition.edges[0].id
    const condition = { path: 'result.approved', op: 'truthy' as const }

    state = dispatch(state, { type: 'update-edge-condition', edgeId, condition })

    expect(state.definition.edges.find((edge) => edge.id === edgeId)?.condition).toEqual(condition)
  })
})

describe('workflow editor state: delete and undo', () => {
  it('deletes a node along with any edge touching it', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 200, y: 0 } })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'end' })

    state = dispatch(state, { type: 'delete-elements', nodeIds: ['end'] })

    expect(state.definition.nodes.map((node) => node.id)).toEqual(['start'])
    expect(state.definition.edges).toEqual([])
    expect(state.definition.layout.end).toBeUndefined()
  })

  it('undoes the last committed change', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    expect(state.definition.nodes).toHaveLength(1)

    state = dispatch(state, { type: 'undo' })

    expect(state.definition.nodes).toHaveLength(0)
  })

  it('mark-saved clears dirty without touching history or the definition', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    const revisionBeforeSave = state.revision
    const historyBeforeSave = state.history

    state = dispatch(state, { type: 'mark-saved' })

    expect(state.dirty).toBe(false)
    expect(state.revision).toBe(revisionBeforeSave)
    expect(state.history).toBe(historyBeforeSave)
    expect(state.definition.nodes).toHaveLength(1)

    // A no-op on an already-clean state (referential no-change, not just a value match).
    const clean = dispatch(state, { type: 'mark-saved' })
    expect(clean).toBe(state)
  })

  it('undoing a move restores both the position and the pin state', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('work', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'work' })
    expect(state.manualPositionIds.has('work')).toBe(false)

    state = dispatch(state, { type: 'move-node', nodeId: 'work', position: { x: 555, y: 777 } })
    expect(state.manualPositionIds.has('work')).toBe(true)
    expect(state.definition.layout.work).toEqual({ x: 555, y: 777 })

    state = dispatch(state, { type: 'undo' })

    expect(state.definition.layout.work).toEqual({ x: 200, y: 0 })
    expect(state.manualPositionIds.has('work')).toBe(false)

    // 'work' is unpinned again post-undo, so Re-layout is free to move it off the stale (200, 0).
    state = dispatch(state, { type: 'auto-layout' })
    expect(state.definition.layout.work).not.toEqual({ x: 200, y: 0 })
  })

  it('undoing a delete restores both the node and its pin state', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('work', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'work' })
    state = dispatch(state, { type: 'move-node', nodeId: 'work', position: { x: 555, y: 777 } })
    expect(state.manualPositionIds.has('work')).toBe(true)

    state = dispatch(state, { type: 'delete-elements', nodeIds: ['work'] })
    expect(state.definition.nodes.map((node) => node.id)).toEqual(['start'])
    expect(state.manualPositionIds.has('work')).toBe(false)

    state = dispatch(state, { type: 'undo' })

    expect(state.definition.nodes.map((node) => node.id)).toEqual(['start', 'work'])
    expect(state.definition.layout.work).toEqual({ x: 555, y: 777 })
    expect(state.manualPositionIds.has('work')).toBe(true)

    // 'work' is pinned again post-undo, so Re-layout must leave it exactly where it was.
    state = dispatch(state, { type: 'auto-layout' })
    expect(state.definition.layout.work).toEqual({ x: 555, y: 777 })
  })

  it('deletes an edge without touching either endpoint node (F4)', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 200, y: 0 } })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'end' })
    const edge = state.definition.edges[0]

    state = dispatch(state, { type: 'delete-elements', edgeIds: [edge.id] })

    expect(state.definition.edges).toEqual([])
    expect(state.definition.nodes.map((node) => node.id)).toEqual(['start', 'end'])
  })

  it('deletes a Loop node along with its body nodes and every edge touching either (F4)', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: loopNode('loop', { maxIterations: 3 }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('work', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 400, y: 0 } })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'loop' })
    state = dispatch(state, { type: 'connect', from: 'loop', to: 'end', fromPort: 'exit' })

    state = dispatch(state, { type: 'delete-elements', nodeIds: ['loop'] })

    expect(state.definition.nodes.map((node) => node.id).sort()).toEqual(['end', 'start'])
    expect(state.definition.edges).toEqual([])
    expect(state.definition.layout.loop).toBeUndefined()
    expect(state.definition.layout.work).toBeUndefined()
  })

  it('unpins a Loop body node that was cascade-deleted with its Loop (F4)', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: loopNode('loop', { maxIterations: 3 }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('work', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'move-node', nodeId: 'work', position: { x: 555, y: 777 } })
    expect(state.manualPositionIds.has('work')).toBe(true)

    state = dispatch(state, { type: 'delete-elements', nodeIds: ['loop'] })

    expect(state.manualPositionIds.has('work')).toBe(false)
  })

  it("drops a deleted node from its Loop's body without touching the Loop itself (F4 review round 1, Important #2)", () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: loopNode('loop', {
        body: { nodeIds: ['a', 'b'] },
        entryNodeId: 'a',
        exitNodeId: 'b',
        maxIterations: 3
      }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('a', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('b', { overrides: { agent: 'claude' } }),
      position: { x: 250, y: 0 }
    })

    state = dispatch(state, { type: 'delete-elements', nodeIds: ['a'] })

    const loop = state.definition.nodes.find((node): node is LoopNode => node.type === 'loop')
    expect(loop?.body.nodeIds).toEqual(['b'])
    expect(state.definition.nodes.some((node) => node.id === 'loop')).toBe(true)
    expect(state.definition.nodes.some((node) => node.id === 'b')).toBe(true)
  })

  it('leaves a deleted entry id in place (not guessed at) so validation flags the broken Loop', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: loopNode('loop', {
        body: { nodeIds: ['a', 'b'] },
        entryNodeId: 'a',
        exitNodeId: 'b',
        maxIterations: 3
      }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('a', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('b', { overrides: { agent: 'claude' } }),
      position: { x: 250, y: 0 }
    })

    state = dispatch(state, { type: 'delete-elements', nodeIds: ['a'] })

    const loop = state.definition.nodes.find((node): node is LoopNode => node.type === 'loop')
    expect(loop?.entryNodeId).toBe('a')
    const problems = validateWorkflowGraph(state.definition, permissiveContext)
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'graph_loop_entry_not_in_body', nodeId: 'loop' })
    )
  })

  it('cascades to delete the Loop when deleting its last remaining body node (an empty body is never produced — the schema requires at least one)', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: loopNode('loop', { maxIterations: 3 }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('work', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })

    state = dispatch(state, { type: 'delete-elements', nodeIds: ['work'] })

    expect(state.definition.nodes.some((node) => node.id === 'loop')).toBe(false)
    expect(state.definition.nodes.some((node) => node.id === 'work')).toBe(false)
  })
})

describe('workflow editor state: Loop save gating (US2 AS4)', () => {
  it('blocks save with a message when a Loop has no maximum iteration count', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: loopNode('loop', { maxIterations: 0 }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('work', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 400, y: 0 } })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'loop' })
    state = dispatch(state, { type: 'connect', from: 'loop', to: 'end', fromPort: 'exit' })

    const problems = validateWorkflowGraph(state.definition, permissiveContext)

    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'graph_loop_missing_max_iterations', nodeId: 'loop' })
    )
  })

  it('saves cleanly once a maximum iteration count is set', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: loopNode('loop', { maxIterations: 3 }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('work', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 400, y: 0 } })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'loop' })
    state = dispatch(state, { type: 'connect', from: 'loop', to: 'end', fromPort: 'exit' })

    const problems = validateWorkflowGraph(state.definition, permissiveContext)

    expect(problems.filter((p) => p.code === 'graph_loop_missing_max_iterations')).toEqual([])
  })
})

describe('workflow editor state: wrap selection in Loop (US2 AS5)', () => {
  it('refuses a back-edge outside a Loop, and "wrap in Loop" wraps the selected nodes', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('a', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('b', { overrides: { agent: 'claude' } }),
      position: { x: 400, y: 0 }
    })
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 600, y: 0 } })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'a' })
    state = dispatch(state, { type: 'connect', from: 'a', to: 'b' })
    state = dispatch(state, { type: 'connect', from: 'b', to: 'end' })
    const edgeCountBeforeRefusal = state.definition.edges.length

    state = dispatch(state, { type: 'connect', from: 'b', to: 'a' })

    expect(state.definition.edges).toHaveLength(edgeCountBeforeRefusal)
    expect(state.lastProblem?.code).toBe('graph_cycle')
    expect(state.lastProblem?.wrapNodeIds).toEqual(['b', 'a'])

    state = dispatch(state, { type: 'wrap-in-loop', nodeIds: ['a', 'b'] })

    const loop = state.definition.nodes.find((node): node is LoopNode => node.type === 'loop')
    expect(loop).toMatchObject({
      body: { nodeIds: ['a', 'b'] },
      entryNodeId: 'a',
      exitNodeId: 'b'
    })
    if (!loop) {
      throw new Error('expected a Loop node to exist after wrapping')
    }
    expect(state.definition.edges).toContainEqual(
      expect.objectContaining({ from: 'start', to: loop?.id })
    )
    expect(state.definition.edges).toContainEqual(expect.objectContaining({ from: 'a', to: 'b' }))
    expect(state.definition.edges).toContainEqual(
      expect.objectContaining({ from: 'b', to: 'end', fromPort: 'exit' })
    )

    // The cycle is resolved (it's now entirely inside the Loop body); only the still-missing
    // maxIterations cap remains (US2 AS4 — the wrap itself doesn't set one).
    const problems = validateWorkflowGraph(state.definition, permissiveContext)
    expect(problems.filter((p) => p.code === 'graph_cycle')).toEqual([])
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'graph_loop_missing_max_iterations', nodeId: loop?.id })
    )

    // Setting the cap is enough for a fully clean result — every accepted wrap must be able to
    // reach this state (review round 1).
    state = dispatch(state, {
      type: 'update-node',
      node: { ...loop, maxIterations: 3 }
    })
    expect(validateWorkflowGraph(state.definition, permissiveContext)).toEqual([])
  })

  it('refuses to wrap a selection that includes a non-existent node', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('a', { overrides: { agent: 'claude' } }),
      position: { x: 0, y: 0 }
    })

    state = dispatch(state, { type: 'wrap-in-loop', nodeIds: ['a', 'missing'] })

    expect(state.lastProblem?.code).toBe('workflow_editor_wrap_invalid_selection')
    expect(state.definition.nodes.some((node) => node.type === 'loop')).toBe(false)
  })

  it('refuses a fan-in selection (two distinct external entries) without mutating anything', () => {
    // start -> a, start -> d, a -> c, d -> c: wrapping {a, d, c} would otherwise collapse both
    // "start -> a" and "start -> d" onto "start -> loop", stranding "d" (review round 1, finding 1).
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    for (const id of ['a', 'd', 'c']) {
      state = dispatch(state, {
        type: 'add-node',
        node: agentNode(id, { overrides: { agent: 'claude' } }),
        position: { x: 0, y: 0 }
      })
    }
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'a' })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'd' })
    state = dispatch(state, { type: 'connect', from: 'a', to: 'c' })
    state = dispatch(state, { type: 'connect', from: 'd', to: 'c' })
    state = dispatch(state, { type: 'connect', from: 'c', to: 'end' })
    const definitionBeforeWrap = state.definition

    state = dispatch(state, { type: 'wrap-in-loop', nodeIds: ['a', 'd', 'c'] })

    expect(state.lastProblem?.code).toBe('workflow_editor_wrap_multiple_entries')
    expect(state.definition).toBe(definitionBeforeWrap)
    expect(state.definition.nodes.some((node) => node.type === 'loop')).toBe(false)
  })

  it('refuses an external edge into a non-entry selected node without rewriting it', () => {
    // start -> a, a -> b, b -> end, plus z -> b: "z" looks like it feeds "b", but wrapping {a, b}
    // would silently rewrite it to feed "a" instead once collapsed onto "start -> loop"
    // (review round 1, finding 2) — refuse instead.
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    for (const id of ['a', 'b', 'z']) {
      state = dispatch(state, {
        type: 'add-node',
        node: agentNode(id, { overrides: { agent: 'claude' } }),
        position: { x: 0, y: 0 }
      })
    }
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'a' })
    state = dispatch(state, { type: 'connect', from: 'a', to: 'b' })
    state = dispatch(state, { type: 'connect', from: 'b', to: 'end' })
    state = dispatch(state, { type: 'connect', from: 'z', to: 'b' })
    const definitionBeforeWrap = state.definition

    state = dispatch(state, { type: 'wrap-in-loop', nodeIds: ['a', 'b'] })

    expect(state.lastProblem?.code).toBe('workflow_editor_wrap_multiple_entries')
    expect(state.definition).toBe(definitionBeforeWrap)
    expect(state.definition.edges).toContainEqual(expect.objectContaining({ from: 'z', to: 'b' }))
  })

  it('refuses a disconnected selection without mutating anything', () => {
    // {a, b} and {x, y} are two unrelated pairs; wrapping all four at once has no single body.
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    for (const id of ['a', 'b', 'x', 'y']) {
      state = dispatch(state, {
        type: 'add-node',
        node: agentNode(id, { overrides: { agent: 'claude' } }),
        position: { x: 0, y: 0 }
      })
    }
    state = dispatch(state, { type: 'connect', from: 'a', to: 'b' })
    state = dispatch(state, { type: 'connect', from: 'x', to: 'y' })
    const definitionBeforeWrap = state.definition

    state = dispatch(state, { type: 'wrap-in-loop', nodeIds: ['a', 'b', 'x', 'y'] })

    expect(state.lastProblem?.code).toBe('workflow_editor_wrap_disconnected_selection')
    expect(state.definition).toBe(definitionBeforeWrap)
  })
})

describe('workflow editor state: unwrap Loop (F4)', () => {
  it('removes the Loop node, keeps its body, and re-links entry/exit edges', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('work', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 400, y: 0 } })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'work' })
    state = dispatch(state, { type: 'connect', from: 'work', to: 'end' })
    state = dispatch(state, { type: 'wrap-in-loop', nodeIds: ['work'] })
    const loop = state.definition.nodes.find((node): node is LoopNode => node.type === 'loop')
    if (!loop) {
      throw new Error('expected a Loop node to exist after wrapping')
    }
    // The wrap redirected the incoming edge onto the Loop id and tagged the outgoing one 'exit'.
    expect(state.definition.edges).toContainEqual(
      expect.objectContaining({ from: 'start', to: loop.id })
    )

    state = dispatch(state, { type: 'unwrap-loop', nodeId: loop.id })

    expect(state.definition.nodes.map((node) => node.id).sort()).toEqual(['end', 'start', 'work'])
    expect(state.definition.edges).toContainEqual(
      expect.objectContaining({ from: 'start', to: 'work' })
    )
    const exitEdge = state.definition.edges.find((edge) => edge.from === 'work')
    expect(exitEdge).toMatchObject({ from: 'work', to: 'end' })
    expect(exitEdge?.fromPort).toBeUndefined()
    expect(state.definition.layout[loop.id]).toBeUndefined()
  })

  it("re-links an edge drawn from the Loop node's own exit handle, not just a body-sourced one (F4 review round 1, Important #1)", () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: loopNode('loop', { maxIterations: 3 }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('work', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'add-node', node: endNode(), position: { x: 400, y: 0 } })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'loop' })
    // Drawn straight from the Loop's own source Handle id="exit" (LoopNode.tsx), unlike the
    // body-sourced form wrap-in-loop itself produces — the case the review found unhandled.
    state = dispatch(state, { type: 'connect', from: 'loop', to: 'end', fromPort: 'exit' })

    state = dispatch(state, { type: 'unwrap-loop', nodeId: 'loop' })

    expect(state.definition.edges.some((edge) => edge.from === 'loop' || edge.to === 'loop')).toBe(
      false
    )
    const exitEdge = state.definition.edges.find((edge) => edge.to === 'end')
    expect(exitEdge).toMatchObject({ from: 'work', to: 'end' })
    expect(exitEdge?.fromPort).toBeUndefined()
  })

  it('drops (rather than dangles) an edge whose rewritten target no longer exists as a node', () => {
    // A malformed stand-in for F4 review Important #2: a Loop whose entry/exit were left
    // dangling by a body-node delete (loopNode()'s default entry/exit is 'work', never added
    // here as a real node) must not have unwrap point an edge at that ghost id.
    const definition: Workflow = {
      version: 1,
      name: 'wf',
      workspacePolicy: 'run-workspace',
      roles: {},
      nodes: [startNode(), loopNode('loop', { maxIterations: 3 }), endNode()],
      edges: [
        { id: 'e1', from: 'start', to: 'loop' },
        { id: 'e2', from: 'loop', to: 'end', fromPort: 'exit' }
      ],
      layout: {}
    }

    const result = unwrapLoopInDefinition(definition, 'loop')

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected unwrap to succeed')
    }
    expect(result.definition.edges).toEqual([])
  })

  it('refuses to unwrap a node that is not a Loop, without mutating anything', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    const definitionBeforeUnwrap = state.definition

    state = dispatch(state, { type: 'unwrap-loop', nodeId: 'start' })

    expect(state.lastProblem?.code).toBe('workflow_editor_unwrap_not_a_loop')
    expect(state.definition).toBe(definitionBeforeUnwrap)
  })

  it('refuses to unwrap a node id that does not exist', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())

    state = dispatch(state, { type: 'unwrap-loop', nodeId: 'missing' })

    expect(state.lastProblem?.code).toBe('workflow_editor_unwrap_not_a_loop')
  })

  it('undoes an unwrap, restoring the Loop node and its rewired edges', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, { type: 'add-node', node: startNode(), position: { x: 0, y: 0 } })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('work', { overrides: { agent: 'claude' } }),
      position: { x: 200, y: 0 }
    })
    state = dispatch(state, { type: 'connect', from: 'start', to: 'work' })
    state = dispatch(state, { type: 'wrap-in-loop', nodeIds: ['work'] })
    const afterWrap = state.definition
    const loop = state.definition.nodes.find((node): node is LoopNode => node.type === 'loop')
    if (!loop) {
      throw new Error('expected a Loop node to exist after wrapping')
    }

    state = dispatch(state, { type: 'unwrap-loop', nodeId: loop.id })
    state = dispatch(state, { type: 'undo' })

    expect(state.definition).toEqual(afterWrap)
  })
})

describe('workflow editor state: dismiss-problem', () => {
  it('clears the last refused command without touching anything else', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('a', { overrides: { agent: 'claude' } }),
      position: { x: 0, y: 0 }
    })
    state = dispatch(state, { type: 'update-node', node: agentNode('missing') })
    expect(state.lastProblem?.code).toBe('workflow_editor_node_not_found')

    state = dispatch(state, { type: 'dismiss-problem' })

    expect(state.lastProblem).toBeUndefined()
    expect(state.definition.nodes.map((node) => node.id)).toEqual(['a'])
  })

  it('is a no-op when there is nothing to dismiss', () => {
    const state = createInitialWorkflowEditorState(emptyWorkflow())

    const next = dispatch(state, { type: 'dismiss-problem' })

    expect(next).toBe(state)
  })
})

describe('workflow editor state: set-role, remove-role (US4 AS1)', () => {
  it('adds a new role, marking the editor dirty and bumping the revision', () => {
    let state = createInitialWorkflowEditorState({ ...emptyWorkflow(), roles: {} })

    state = dispatch(state, { type: 'set-role', roleId: 'dev', role: role() })

    expect(state.definition.roles).toEqual({ dev: role() })
    expect(state.dirty).toBe(true)
    expect(state.revision).toBe(1)
  })

  it('replaces an existing role by id', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())

    state = dispatch(state, {
      type: 'set-role',
      roleId: 'dev',
      role: role({ name: 'Senior Dev' })
    })

    expect(state.definition.roles.dev).toEqual(role({ name: 'Senior Dev' }))
  })

  it('removes a role and clears it from every node that referenced it', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('a', { roleId: 'dev' }),
      position: { x: 0, y: 0 }
    })

    state = dispatch(state, { type: 'remove-role', roleId: 'dev' })

    expect(state.definition.roles.dev).toBeUndefined()
    expect(state.definition.nodes.find((node) => node.id === 'a')).toMatchObject({
      roleId: undefined
    })
  })

  it('removing a role leaves nodes referencing a different role untouched', () => {
    let state = createInitialWorkflowEditorState({
      ...emptyWorkflow(),
      roles: { dev: role(), reviewer: role({ id: 'reviewer', name: 'Reviewer' }) }
    })
    state = dispatch(state, {
      type: 'add-node',
      node: agentNode('a', { roleId: 'reviewer' }),
      position: { x: 0, y: 0 }
    })

    state = dispatch(state, { type: 'remove-role', roleId: 'dev' })

    expect(state.definition.roles.reviewer).toBeDefined()
    expect(state.definition.nodes.find((node) => node.id === 'a')).toMatchObject({
      roleId: 'reviewer'
    })
  })
})
