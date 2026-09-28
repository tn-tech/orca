// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type {
  LoopNode,
  StartNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { checkLoopReferencesMissingNodes } from './workflow-loop-integrity-check'

function startNode(): StartNode {
  return { id: 'start', type: 'start', title: 'Start' }
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

function workflow(patch: Partial<Workflow> = {}): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [startNode()],
    edges: [],
    layout: {},
    ...patch
  }
}

describe('checkLoopReferencesMissingNodes', () => {
  it('flags a Loop whose body lists a node that is not in the workflow at all', () => {
    // Distinct from the shared `graph_loop_entry_not_in_body` check (entry/exit not in body) —
    // this is a defensive check (F4 review round 1, Important #2) for a body id that was never
    // a real node to begin with, e.g. a hand-edited or otherwise not-editor-authored file. The
    // editor's own delete command never produces this (`deleteElementsFromDefinition` always
    // strips a deleted id out of every Loop's body), so it should never fire on ordinary use.
    const problems = checkLoopReferencesMissingNodes(workflow({ nodes: [startNode(), loopNode()] }))

    expect(problems).toContainEqual(
      expect.objectContaining({
        code: 'graph_loop_references_missing_node',
        nodeId: 'loop',
        severity: 'error'
      })
    )
  })

  it('flags a Loop whose entryNodeId or exitNodeId is not a real node', () => {
    const problems = checkLoopReferencesMissingNodes(
      workflow({
        nodes: [
          startNode(),
          loopNode({
            body: { nodeIds: ['work', 'entry-ghost', 'exit-ghost'] },
            entryNodeId: 'entry-ghost',
            exitNodeId: 'exit-ghost'
          })
        ]
      })
    )

    const codes = problems.map((problem) => problem.code)
    expect(codes.filter((code) => code === 'graph_loop_references_missing_node')).toHaveLength(3)
  })

  it('is clean for a Loop whose body/entry/exit all name real nodes', () => {
    const workDefinition = workflow({
      nodes: [startNode(), loopNode(), { id: 'work', type: 'end', title: 'work' }]
    })

    expect(checkLoopReferencesMissingNodes(workDefinition)).toEqual([])
  })

  it('is clean for a workflow with no Loop nodes', () => {
    expect(checkLoopReferencesMissingNodes(workflow())).toEqual([])
  })
})
