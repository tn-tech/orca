import { describe, expect, it } from 'vitest'
import type { Node, ReflectionNode, RouterNode, Workflow } from './workflow-definition-types'
import { validateWorkflowGraph } from './workflow-graph-validation'

const agentWork: Node = {
  id: 'work',
  type: 'agent',
  title: 'Work',
  prompt: 'go',
  workspace: 'run',
  resultContract: { type: 'object' },
  artifacts: [],
  question: { timeoutMs: 1, escalationGraceMs: 1 }
}
const routerWork: RouterNode = {
  id: 'work',
  type: 'router',
  title: 'Work',
  prompt: 'choose',
  choices: ['done']
}
const reflectionWork: ReflectionNode = {
  id: 'work',
  type: 'reflection',
  title: 'Work',
  prompt: 'reflect'
}

function definitionWith(work: Node): Workflow {
  const toEnd =
    work.type === 'router'
      ? { id: 'e2', from: 'work', to: 'end', fromPort: 'done' }
      : { id: 'e2', from: 'work', to: 'end' }
  return {
    version: 1,
    name: 'unassigned',
    workspacePolicy: 'run-workspace',
    roles: { dev: { id: 'dev', name: 'Dev', agent: 'claude', systemPrompt: '', skills: [] } },
    layout: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      work,
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [{ id: 'e1', from: 'start', to: 'work' }, toEnd]
  }
}

function unassignedProblems(definition: Workflow) {
  return validateWorkflowGraph(definition, {
    agentSupportsModel: () => true,
    allowlistedSources: []
  }).filter((problem) => problem.code === 'graph_node_unassigned')
}

describe('validateWorkflowGraph: agent-dispatching node with no role or agent', () => {
  it.each([
    ['agent', agentWork],
    ['router', routerWork],
    ['reflection', reflectionWork]
  ])('reports a %s node with neither a role nor an agent override', (_kind, work) => {
    expect(unassignedProblems(definitionWith(work))).toEqual([
      {
        code: 'graph_node_unassigned',
        message: 'Node "work" has no agent assigned: set a role or an agent override.',
        nodeId: 'work',
        severity: 'error'
      }
    ])
  })

  it('accepts a node with a role', () => {
    expect(unassignedProblems(definitionWith({ ...agentWork, roleId: 'dev' }))).toEqual([])
  })

  it('accepts a role-less node whose overrides name an agent', () => {
    expect(
      unassignedProblems(definitionWith({ ...reflectionWork, overrides: { agent: 'codex' } }))
    ).toEqual([])
  })

  it('leaves an unknown roleId to graph_unknown_role instead of double-reporting', () => {
    const problems = validateWorkflowGraph(definitionWith({ ...routerWork, roleId: 'ghost' }), {
      agentSupportsModel: () => true,
      allowlistedSources: []
    })
    expect(problems.map((problem) => problem.code)).toContain('graph_unknown_role')
    expect(problems.map((problem) => problem.code)).not.toContain('graph_node_unassigned')
  })

  it('reports nothing for the fully assigned definition', () => {
    expect(
      validateWorkflowGraph(definitionWith({ ...agentWork, roleId: 'dev' }), {
        agentSupportsModel: () => true,
        allowlistedSources: []
      })
    ).toEqual([])
  })
})
