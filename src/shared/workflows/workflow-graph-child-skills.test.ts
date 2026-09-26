import { describe, expect, it } from 'vitest'
import type { AgentNode, SkillReference, Workflow } from './workflow-definition-types'
import { validateWorkflowGraph } from './workflow-graph-validation'

const repositorySkill: SkillReference = {
  name: 'model-review',
  source: { kind: 'repository', location: 'https://github.com/acme/skills' },
  required: true
}
const pluginSkill: SkillReference = {
  name: 'deck-writer',
  source: { kind: 'plugin', plugin: 'acme-decks' },
  required: true
}

function definitionWith(work: Partial<AgentNode>, roleSkills: SkillReference[]): Workflow {
  const node: AgentNode = {
    id: 'work',
    type: 'agent',
    title: 'Work',
    roleId: 'dev',
    prompt: 'go',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 1, escalationGraceMs: 1 },
    ...work
  }
  return {
    version: 1,
    name: 'child-skills',
    workspacePolicy: 'run-workspace',
    roles: {
      dev: { id: 'dev', name: 'Dev', agent: 'claude', systemPrompt: '', skills: roleSkills }
    },
    layout: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      node,
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'work' },
      { id: 'e2', from: 'work', to: 'end' }
    ]
  }
}

function childSkillProblems(definition: Workflow) {
  return validateWorkflowGraph(definition, {
    agentSupportsModel: () => true,
    allowlistedSources: ['https://github.com/acme/skills']
  }).filter((problem) => problem.code === 'graph_child_workspace_repository_skills')
}

describe('validateWorkflowGraph: child workspace with repository skills', () => {
  it('reports a child-placed node whose role needs repository skills', () => {
    expect(childSkillProblems(definitionWith({ workspace: 'child' }, [repositorySkill]))).toEqual([
      expect.objectContaining({ nodeId: 'work', roleId: 'dev', severity: 'error' })
    ])
  })

  it('reports repository skills added by a node override', () => {
    const definition = definitionWith(
      { workspace: 'child', overrides: { skills: [repositorySkill] } },
      []
    )
    expect(childSkillProblems(definition)).toHaveLength(1)
  })

  it('accepts run-workspace placement and child nodes with only plugin skills', () => {
    expect(childSkillProblems(definitionWith({ workspace: 'run' }, [repositorySkill]))).toEqual([])
    expect(childSkillProblems(definitionWith({ workspace: 'child' }, [pluginSkill]))).toEqual([])
  })
})
