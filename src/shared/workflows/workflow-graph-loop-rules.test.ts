import { describe, expect, it } from 'vitest'
import type { Edge, Node, Workflow } from './workflow-definition-types'
import { validateWorkflowGraph } from './workflow-graph-validation'

function gate(id: string): Node {
  return {
    id,
    type: 'approval',
    title: id,
    question: 'Again?',
    options: ['ok', 'redo'],
    timeoutMs: 1,
    escalationGraceMs: 1
  }
}

function join(id: string): Node {
  return { id, type: 'join', title: id, policy: 'any', onFailure: 'fail' }
}

/** Start -> Loop[gate -(ok|redo)-> sink] -exit-> End, plus `extra`. */
function workflow(extraNodes: Node[], edges: Edge[], body = ['gate', 'sink']): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      {
        id: 'loop',
        type: 'loop',
        title: 'Loop',
        body: { nodeIds: body },
        entryNodeId: 'gate',
        exitNodeId: 'gate',
        maxIterations: 3,
        exitCondition: { path: 'option', op: 'eq', value: 'ok' },
        onCapReached: 'fail'
      },
      gate('gate'),
      join('sink'),
      { id: 'end', type: 'end', title: 'End' },
      ...extraNodes
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'loop' },
      { id: 'e-ok', from: 'gate', to: 'sink', fromPort: 'ok' },
      { id: 'e-redo', from: 'gate', to: 'sink', fromPort: 'redo' },
      ...edges
    ],
    layout: {}
  }
}

function problems(definition: Workflow) {
  return validateWorkflowGraph(definition, {
    agentSupportsModel: () => true,
    allowlistedSources: []
  })
}

describe('checkLoopNodes: exit edges into the Loop body (F11 fix round 1)', () => {
  it('flags a Loop-owned exit edge that targets a node inside the same Loop', () => {
    const definition = workflow([], [{ id: 'bad', from: 'loop', to: 'sink', fromPort: 'exit' }])
    expect(problems(definition)).toContainEqual(
      expect.objectContaining({
        code: 'graph_loop_exit_edge_into_body',
        severity: 'error',
        nodeId: 'loop',
        edgeId: 'bad'
      })
    )
  })

  it('flags a body-sourced exit edge (the shape Wrap in Loop produces) into the same body', () => {
    const definition = workflow(
      [join('next')],
      [{ id: 'bad', from: 'sink', to: 'next', fromPort: 'exit' }],
      ['gate', 'sink', 'next']
    )
    expect(problems(definition)).toContainEqual(
      expect.objectContaining({ code: 'graph_loop_exit_edge_into_body', edgeId: 'bad' })
    )
  })

  it('accepts exit edges that leave the Loop', () => {
    const definition = workflow([], [{ id: 'out', from: 'loop', to: 'end', fromPort: 'exit' }])
    expect(problems(definition).filter((p) => p.severity === 'error')).toEqual([])
  })
})

describe('checkPortedNodes: an Approval option with no edge inside a Loop', () => {
  it('says the answer stops the run and how to keep iterating', () => {
    const definition = workflow(
      [],
      [{ id: 'out', from: 'loop', to: 'end', fromPort: 'exit' }],
      ['gate', 'sink']
    )
    definition.edges = definition.edges.filter((edge) => edge.id !== 'e-redo')
    expect(problems(definition)).toContainEqual({
      code: 'graph_option_missing_edge',
      severity: 'warning',
      nodeId: 'gate',
      message:
        'Node "gate" option "redo" has no outgoing edge; answering "redo" will stop the run. Connect it to a node inside the loop to continue iterating.'
    })
  })

  it('keeps the plain warning for an Approval outside any Loop', () => {
    const definition = workflow(
      [gate('outside')],
      [
        { id: 'out', from: 'loop', to: 'outside', fromPort: 'exit' },
        { id: 'fin', from: 'outside', to: 'end', fromPort: 'ok' }
      ]
    )
    expect(problems(definition)).toContainEqual(
      expect.objectContaining({
        nodeId: 'outside',
        message: 'Node "outside" option "redo" has no outgoing edge; choosing it stops the run.'
      })
    )
  })
})
