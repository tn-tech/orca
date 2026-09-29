// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoopNode, Workflow } from '../../../../shared/workflows/workflow-definition-types'

const { workflowReadMock, workflowWriteMock } = vi.hoisted(() => ({
  workflowReadMock: vi.fn(),
  workflowWriteMock: vi.fn()
}))
vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowRead: workflowReadMock,
  workflowWrite: workflowWriteMock
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { useWorkflowEditorSession } from './use-workflow-editor-session'
import { useWorkflowEditorMutations } from './use-workflow-editor-mutations'

const settings = { activeRuntimeEnvironmentId: null }

function workflow(patch: Partial<Workflow> = {}): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [{ id: 'e1', from: 'start', to: 'end' }],
    layout: { start: { x: 0, y: 0 }, end: { x: 320, y: 0 } },
    ...patch
  }
}

function loopNode(patch: Partial<LoopNode> = {}): LoopNode {
  return {
    id: 'loop',
    type: 'loop',
    title: 'Loop',
    body: { nodeIds: ['work'] },
    entryNodeId: 'work',
    exitNodeId: 'work',
    maxIterations: 3,
    exitCondition: { path: 'approved', op: 'truthy' },
    onCapReached: 'fail',
    ...patch
  }
}

function useHarness(): {
  session: ReturnType<typeof useWorkflowEditorSession>
  selectedNodeId: string | undefined
  selectedEdgeId: string | undefined
  setSelectedNodeId: (id: string | undefined) => void
  setSelectedEdgeId: (id: string | undefined) => void
  mutations: ReturnType<typeof useWorkflowEditorMutations>
} {
  const session = useWorkflowEditorSession({ settings, repoId: 'repo-1' })
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>()
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>()
  const mutations = useWorkflowEditorMutations({
    session,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNodeId,
    setSelectedEdgeId
  })
  return {
    session,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNodeId,
    setSelectedEdgeId,
    mutations
  }
}

beforeEach(() => {
  workflowReadMock.mockReset()
  workflowWriteMock.mockReset()
})

async function readyHarness(initial: Workflow) {
  workflowReadMock.mockResolvedValue({ definition: initial, revision: 'r1', problems: [] })
  const view = renderHook(() => useHarness())
  await act(() => view.result.current.session.open({ name: 'wf', source: 'project' }))
  return view
}

describe('useWorkflowEditorMutations', () => {
  it('deleteNode removes the node and its edges, and clears the selection', async () => {
    const view = await readyHarness(workflow())
    act(() => view.result.current.setSelectedNodeId('end'))

    act(() => view.result.current.mutations.deleteNode('end'))

    expect(view.result.current.session.editor.state.definition.nodes.map((n) => n.id)).toEqual([
      'start'
    ])
    expect(view.result.current.session.editor.state.definition.edges).toEqual([])
    expect(view.result.current.selectedNodeId).toBeUndefined()
  })

  it('deleteEdge removes only the edge, and clears the edge selection', async () => {
    const view = await readyHarness(workflow())
    act(() => view.result.current.setSelectedEdgeId('e1'))

    act(() => view.result.current.mutations.deleteEdge('e1'))

    expect(view.result.current.session.editor.state.definition.edges).toEqual([])
    expect(view.result.current.session.editor.state.definition.nodes).toHaveLength(2)
    expect(view.result.current.selectedEdgeId).toBeUndefined()
  })

  it('deleteSelection prefers the selected node over a selected edge', async () => {
    const view = await readyHarness(workflow())
    act(() => {
      view.result.current.setSelectedNodeId('end')
      view.result.current.setSelectedEdgeId('e1')
    })

    act(() => view.result.current.mutations.deleteSelection())

    expect(view.result.current.session.editor.state.definition.nodes.map((n) => n.id)).toEqual([
      'start'
    ])
    expect(view.result.current.selectedNodeId).toBeUndefined()
  })

  it('deleteSelection is a no-op when nothing is selected', async () => {
    const view = await readyHarness(workflow())
    const before = view.result.current.session.editor.state.definition

    act(() => view.result.current.mutations.deleteSelection())

    expect(view.result.current.session.editor.state.definition).toBe(before)
  })

  it('unwrapLoop removes the Loop, keeps its body, and clears the selection', async () => {
    const view = await readyHarness(
      workflow({ nodes: [{ id: 'start', type: 'start', title: 'Start' }, loopNode()], edges: [] })
    )
    act(() => view.result.current.setSelectedNodeId('loop'))

    act(() => view.result.current.mutations.unwrapLoop('loop'))

    expect(view.result.current.session.editor.state.definition.nodes.map((n) => n.id)).toEqual([
      'start'
    ])
    expect(view.result.current.selectedNodeId).toBeUndefined()
  })

  it('editLoop adds a node to the Loop body and keeps the Loop selected (F11)', async () => {
    const view = await readyHarness(
      workflow({
        nodes: [
          { id: 'start', type: 'start', title: 'Start' },
          loopNode(),
          { id: 'end', type: 'end', title: 'End' },
          {
            id: 'gate',
            type: 'approval',
            title: 'Gate',
            question: 'Again?',
            options: ['ok'],
            timeoutMs: 1,
            escalationGraceMs: 1
          }
        ],
        edges: [],
        layout: { loop: { x: 0, y: 0 }, work: { x: 40, y: 40 } }
      })
    )
    act(() => view.result.current.setSelectedNodeId('loop'))

    act(() =>
      view.result.current.mutations.editLoop('loop', { kind: 'add-member', nodeId: 'gate' })
    )

    const loop = view.result.current.session.editor.state.definition.nodes.find(
      (node) => node.id === 'loop'
    )
    expect(loop).toMatchObject({ body: { nodeIds: ['work', 'gate'] } })
    expect(view.result.current.selectedNodeId).toBe('loop')
  })

  it('undo restores the prior definition', async () => {
    const view = await readyHarness(workflow())
    act(() =>
      view.result.current.session.editor.dispatch({
        type: 'add-node',
        node: { id: 'extra', type: 'end', title: 'Extra' },
        position: { x: 0, y: 0 }
      })
    )
    expect(view.result.current.session.editor.state.definition.nodes).toHaveLength(3)

    act(() => view.result.current.mutations.undo())

    expect(view.result.current.session.editor.state.definition.nodes).toHaveLength(2)
  })

  it('undo clears a selection that undo just made stale (F4 review round 1, Minor #4)', async () => {
    const view = await readyHarness(workflow())
    act(() =>
      view.result.current.session.editor.dispatch({
        type: 'add-node',
        node: { id: 'extra', type: 'end', title: 'Extra' },
        position: { x: 0, y: 0 }
      })
    )
    act(() => view.result.current.setSelectedNodeId('extra'))

    act(() => view.result.current.mutations.undo())

    expect(
      view.result.current.session.editor.state.definition.nodes.some((n) => n.id === 'extra')
    ).toBe(false)
    expect(view.result.current.selectedNodeId).toBeUndefined()
  })

  it('undo leaves the selection alone when the selected element survives it', async () => {
    const view = await readyHarness(workflow())
    act(() =>
      view.result.current.session.editor.dispatch({
        type: 'add-node',
        node: { id: 'extra', type: 'end', title: 'Extra' },
        position: { x: 0, y: 0 }
      })
    )
    act(() => view.result.current.setSelectedNodeId('start'))

    act(() => view.result.current.mutations.undo())

    expect(view.result.current.selectedNodeId).toBe('start')
  })
})
