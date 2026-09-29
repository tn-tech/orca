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

  it("names every quoted node id in a message, not just the problem's own node", () => {
    const described = describeWorkflowProblem(
      problem({ message: 'Loop "start" exit node "agent-3f2a" is not in its body.' }),
      definition
    )

    expect(described.message).toBe('Loop "Start" exit node "Review code" is not in its body.')
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
