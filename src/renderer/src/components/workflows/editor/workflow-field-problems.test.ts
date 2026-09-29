import { describe, expect, it } from 'vitest'
import type { Node, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { checkWorkflowFields } from './workflow-field-problems'

const agent: Node = {
  id: 'agent-1',
  type: 'agent',
  title: 'Review',
  prompt: 'Review the diff.',
  workspace: 'run',
  resultContract: { type: 'object' },
  artifacts: [],
  question: { timeoutMs: 1000, escalationGraceMs: 1000 }
}

function workflow(nodes: Node[] = [agent]): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      ...nodes,
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [],
    layout: {}
  }
}

describe('checkWorkflowFields', () => {
  it('reports nothing for a storable definition', () => {
    expect(checkWorkflowFields(workflow())).toEqual({ storable: true, problems: [] })
  })

  it('names an empty title as a friendly, node-scoped error', () => {
    const result = checkWorkflowFields(workflow([{ ...agent, title: '' }]))

    expect(result.storable).toBe(false)
    expect(result.problems).toEqual([
      {
        code: 'workflow_field_required',
        message: 'Title is required.',
        nodeId: 'agent-1',
        severity: 'error'
      }
    ])
  })

  it('names an empty prompt', () => {
    const result = checkWorkflowFields(workflow([{ ...agent, prompt: '' }]))

    expect(result.problems.map((problem) => problem.message)).toEqual(['Prompt is required.'])
    expect(result.problems[0]?.nodeId).toBe('agent-1')
  })

  it('names an empty router choice by its 1-based position', () => {
    const router: Node = {
      id: 'router-1',
      type: 'router',
      title: 'Route',
      prompt: 'Pick one.',
      choices: ['yes', '']
    }

    const result = checkWorkflowFields(workflow([router]))

    expect(result.problems).toEqual([
      {
        code: 'workflow_field_required',
        message: 'Choice 2 is empty.',
        nodeId: 'router-1',
        severity: 'error'
      }
    ])
  })

  it('asks for at least one approval option when the list is empty', () => {
    const approval: Node = {
      id: 'approval-1',
      type: 'approval',
      title: 'Approve',
      question: 'Ship it?',
      options: [],
      timeoutMs: 1000,
      escalationGraceMs: 1000
    }

    const result = checkWorkflowFields(workflow([approval]))

    expect(result.problems.map((problem) => problem.message)).toEqual([
      'Options: add at least one.'
    ])
  })

  it('attaches edge and role ids to issues found on them', () => {
    const definition: Workflow = {
      ...workflow(),
      edges: [{ id: 'edge-1', from: '', to: 'end' }],
      roles: { dev: { id: 'dev', name: '', agent: 'claude', systemPrompt: 'x', skills: [] } }
    }

    const result = checkWorkflowFields(definition)

    expect(result.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ edgeId: 'edge-1', code: 'workflow_field_required' }),
        expect.objectContaining({
          roleId: 'dev',
          message: 'Name is required.',
          code: 'workflow_field_required'
        })
      ])
    )
  })

  // `graph_loop_missing_max_iterations` already names this one; a second row would be noise.
  it('keeps a Loop with no cap unstorable without a duplicate field problem', () => {
    const loop: Node = {
      id: 'loop-1',
      type: 'loop',
      title: 'Loop',
      body: { nodeIds: ['agent-1'] },
      entryNodeId: 'agent-1',
      exitNodeId: 'agent-1',
      maxIterations: 0,
      exitCondition: { op: 'truthy', path: 'done' },
      onCapReached: 'fail'
    }

    expect(checkWorkflowFields(workflow([agent, loop]))).toEqual({ storable: false, problems: [] })
  })

  it('names an edge endpoint field instead of its raw schema key', () => {
    const result = checkWorkflowFields({
      ...workflow(),
      edges: [{ id: 'edge-1', from: '', to: 'end' }]
    })

    expect(result.problems.map((problem) => problem.message)).toEqual(['Source node is required.'])
  })

  it('words an issue with no field path without a dangling field name', () => {
    const definition = { ...workflow(), unexpected: true }

    const result = checkWorkflowFields(definition)

    expect(result.problems[0]?.message).toMatch(/^This workflow has an invalid value: /)
  })
})
