import { describe, expect, it } from 'vitest'
import type { LoopNode, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import {
  loopParentMap,
  resolveEdgeSourceId,
  toAbsoluteNodePosition,
  toFlowEdges
} from './WorkflowCanvas'

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

describe('loopParentMap', () => {
  it('maps every Loop body node id to its own Loop id', () => {
    const nodes: Workflow['nodes'] = [
      { id: 'start', type: 'start', title: 'Start' },
      loopNode({ body: { nodeIds: ['implement', 'review'] } })
    ]

    expect(loopParentMap(nodes)).toEqual(
      new Map([
        ['implement', 'loop'],
        ['review', 'loop']
      ])
    )
  })
})

describe('toAbsoluteNodePosition', () => {
  const layout: Workflow['layout'] = { loop: { x: 100, y: 40 } }
  const parentOf = new Map([['work', 'loop']])

  it('adds the parent Loop position to a body node drag (review round 1, finding 3)', () => {
    // React Flow reports "work"'s drag position relative to "loop"'s own position.
    const result = toAbsoluteNodePosition(layout, parentOf, 'work', { x: 20, y: 15 })

    expect(result).toEqual({ x: 120, y: 55 })
  })

  it('passes a node with no Loop parent through unchanged', () => {
    const result = toAbsoluteNodePosition(layout, parentOf, 'start', { x: 20, y: 15 })

    expect(result).toEqual({ x: 20, y: 15 })
  })

  it('treats a missing parent layout entry as the origin', () => {
    const result = toAbsoluteNodePosition({}, parentOf, 'work', { x: 20, y: 15 })

    expect(result).toEqual({ x: 20, y: 15 })
  })
})

describe('toFlowEdges', () => {
  const definition: Workflow = {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [],
    edges: [
      { id: 'edge-1', from: 'start', to: 'work' },
      { id: 'edge-2', from: 'work', to: 'end' }
    ],
    layout: {}
  }

  it('marks only the selected edge selected', () => {
    const [selected, other] = toFlowEdges(definition, 'edge-1')

    expect(selected.selected).toBe(true)
    expect(other.selected).toBe(false)
  })

  it('gives a selected edge a visually distinct stroke (F4: edges must look selected)', () => {
    const [selected, unselected] = toFlowEdges(definition, 'edge-1')

    expect(selected.style?.stroke).not.toBe(unselected.style?.stroke)
  })

  it('renders no selection distinctly when nothing is selected', () => {
    const [first, second] = toFlowEdges(definition, undefined)

    expect(first.selected).toBe(false)
    expect(second.selected).toBe(false)
    expect(first.style?.stroke).toBe(second.style?.stroke)
  })

  it('sources a Loop exit edge from the Loop, not the body node (F10 round 1: only LoopNode has an "exit" handle)', () => {
    const exitEdgeDefinition: Workflow = {
      ...definition,
      edges: [{ id: 'exit-edge', from: 'agentInLoop', to: 'end', fromPort: 'exit' }]
    }
    const parentOf = new Map([['agentInLoop', 'loop']])

    const [flowEdge] = toFlowEdges(exitEdgeDefinition, undefined, new Map(), parentOf)

    expect(flowEdge.source).toBe('loop')
    expect(flowEdge.sourceHandle).toBe('exit')
    expect(flowEdge.target).toBe('end')
  })
})

describe('resolveEdgeSourceId (mirrors the engine loopExitSourceId, workflow-frontier.ts)', () => {
  const parentOf = new Map([['agentInLoop', 'loop']])

  it('resolves an exit edge to its owning Loop id', () => {
    expect(resolveEdgeSourceId(parentOf, { from: 'agentInLoop', fromPort: 'exit' })).toBe('loop')
  })

  it('leaves a non-exit edge unresolved (its own from stands)', () => {
    expect(resolveEdgeSourceId(parentOf, { from: 'agentInLoop', fromPort: undefined })).toBe(
      'agentInLoop'
    )
  })

  it('leaves a Router/Approval choice edge unresolved (fromPort names the choice, not "exit")', () => {
    expect(resolveEdgeSourceId(parentOf, { from: 'router', fromPort: 'Option 1' })).toBe('router')
  })

  it('falls back to the raw from id when no Loop owns it (malformed data)', () => {
    expect(resolveEdgeSourceId(new Map(), { from: 'orphan', fromPort: 'exit' })).toBe('orphan')
  })
})
