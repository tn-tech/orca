// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type {
  AgentNode,
  EndNode,
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
})
