import { describe, expect, it } from 'vitest'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../../shared/workflows/workflow-definition-types'
import { describeWorkflowProblem } from './workflow-problem-labels'

const definition: Workflow = {
  version: 1,
  name: 'wf',
  workspacePolicy: 'run-workspace',
  roles: {
    dev: { id: 'dev', name: 'Developer', agent: 'claude', systemPrompt: 'x', skills: [] }
  },
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    {
      id: 'agent-3f2a',
      type: 'agent',
      title: 'Review code',
      prompt: 'p',
      workspace: 'run',
      resultContract: { type: 'object' },
      artifacts: [],
      question: { timeoutMs: 1, escalationGraceMs: 1 }
    },
    { id: 'end', type: 'end', title: 'End' }
  ],
  edges: [{ id: 'edge-9', from: 'start', to: 'agent-3f2a' }],
  layout: {}
}

function problem(patch: Partial<WorkflowProblem>): WorkflowProblem {
  return { code: 'graph_x', message: 'm', severity: 'error', ...patch }
}

describe('describeWorkflowProblem', () => {
  it('names a node by its title in both the message and the location', () => {
    const described = describeWorkflowProblem(
      problem({
        message: 'Node "agent-3f2a" is not reachable from Start.',
        nodeId: 'agent-3f2a'
      }),
      definition
    )

    expect(described).toEqual({
      message: 'Node "Review code" is not reachable from Start.',
      location: 'Node "Review code"'
    })
  })

  it('renames only the element the problem declares, leaving other quoted ids raw', () => {
    const described = describeWorkflowProblem(
      problem({
        message: 'Loop "start" exit node "agent-3f2a" is not in its body.',
        nodeId: 'start'
      }),
      definition
    )

    expect(described.message).toBe('Loop "Start" exit node "agent-3f2a" is not in its body.')
  })

  // Loop rule messages quote only node ids, so every one of them can be named (F11).
  it('names every node a Loop problem quotes', () => {
    const described = describeWorkflowProblem(
      problem({
        code: 'graph_loop_exit_not_in_body',
        message: 'Loop "start" exit node "agent-3f2a" is not in its body.',
        nodeId: 'start'
      }),
      definition
    )

    expect(described.message).toBe('Loop "Start" exit node "Review code" is not in its body.')
  })

  // A choice text that happens to equal a node id is choice text, not that node.
  it('never rewrites option text that matches another node id', () => {
    const described = describeWorkflowProblem(
      problem({
        message: 'Node "agent-3f2a" option "end" has more than one outgoing edge.',
        nodeId: 'agent-3f2a'
      }),
      definition
    )

    expect(described.message).toBe(
      'Node "Review code" option "end" has more than one outgoing edge.'
    )
  })

  it('leaves a message without a declared location untouched', () => {
    expect(
      describeWorkflowProblem(problem({ message: 'Node "agent-3f2a" x' }), definition).message
    ).toBe('Node "agent-3f2a" x')
  })

  it("names an edge by its endpoints' titles", () => {
    const described = describeWorkflowProblem(
      problem({ message: 'Edge "edge-9" closes a cycle outside any Loop body.', edgeId: 'edge-9' }),
      definition
    )

    expect(described).toEqual({
      message: 'Edge "Start → Review code" closes a cycle outside any Loop body.',
      location: 'Edge "Start → Review code"'
    })
  })

  it('names an option edge with its port so sibling option edges read differently', () => {
    const withPort: Workflow = {
      ...definition,
      edges: [{ id: 'edge-9', from: 'start', to: 'agent-3f2a', fromPort: 'redo' }]
    }
    expect(
      describeWorkflowProblem(problem({ message: 'Edge "edge-9" x.', edgeId: 'edge-9' }), withPort)
        .message
    ).toBe('Edge "Start (redo) → Review code" x.')
  })

  it('lets a declared edge id win over a node id it collides with in a Loop problem', () => {
    const colliding: Workflow = {
      ...definition,
      edges: [{ id: 'end', from: 'start', to: 'agent-3f2a' }]
    }
    const described = describeWorkflowProblem(
      problem({
        code: 'graph_loop_body_edge_escapes',
        message: 'Edge "end" leaves loop "start"\'s body without going through a loop port.',
        edgeId: 'end',
        nodeId: 'start'
      }),
      colliding
    )
    expect(described.message).toBe(
      'Edge "Start → Review code" leaves loop "Start"\'s body without going through a loop port.'
    )
  })

  it('spells out that an unwired Approval option inside a Loop stops the run', () => {
    const looped: Workflow = {
      ...definition,
      nodes: [
        ...definition.nodes,
        {
          id: 'gate',
          type: 'approval',
          title: 'Sign off',
          question: 'q',
          options: ['redo'],
          timeoutMs: 1,
          escalationGraceMs: 1
        },
        {
          id: 'loop',
          type: 'loop',
          title: 'Loop',
          body: { nodeIds: ['gate'] },
          entryNodeId: 'gate',
          exitNodeId: 'gate',
          maxIterations: 2,
          exitCondition: { path: 'option', op: 'truthy' },
          onCapReached: 'fail'
        }
      ]
    }
    const described = describeWorkflowProblem(
      problem({
        code: 'graph_option_missing_edge',
        severity: 'warning',
        // What an older host sends: the plain, loop-unaware warning.
        message: 'Node "gate" option "redo" has no outgoing edge; choosing it stops the run.',
        nodeId: 'gate'
      }),
      looped
    )
    expect(described.message).toBe(
      'Node "Sign off" option "redo" has no outgoing edge; answering "redo" will stop the run. Connect it to a node inside the loop to continue iterating.'
    )
  })

  it('names a role by its display name', () => {
    expect(describeWorkflowProblem(problem({ roleId: 'dev' }), definition).location).toBe(
      'Role "Developer"'
    )
  })

  it('falls back to the raw id for elements the definition no longer has', () => {
    expect(
      describeWorkflowProblem(problem({ message: 'Node "gone" x', nodeId: 'gone' }), definition)
    ).toEqual({ message: 'Node "gone" x', location: 'Node "gone"' })
  })

  it('names an untitled node by its type instead of its generated id', () => {
    const untitled: Workflow = {
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === 'agent-3f2a' ? { ...node, title: '' } : node
      )
    }

    expect(
      describeWorkflowProblem(
        problem({ message: 'Node "agent-3f2a" x', nodeId: 'agent-3f2a' }),
        untitled
      )
    ).toEqual({ message: 'Node "Untitled agent" x', location: 'Node "Untitled agent"' })
  })
})
