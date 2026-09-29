// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphValidationContext } from '../../../../shared/workflows/workflow-graph-validation'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'

const { workflowValidateMock } = vi.hoisted(() => ({ workflowValidateMock: vi.fn() }))
vi.mock('@/runtime/runtime-workflow-client', () => ({ workflowValidate: workflowValidateMock }))

import { hasBlockingProblemsAfterSave } from './workflow-post-save-validation'

const settings = { activeRuntimeEnvironmentId: null }

const context: GraphValidationContext = {
  agentSupportsModel: () => true,
  isKnownAgent: () => true,
  allowlistedSources: []
}

function cleanWorkflow(): Workflow {
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
    layout: {}
  }
}

function workflowWithUnassignedAgent(): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      {
        id: 'agent',
        type: 'agent',
        title: 'Agent',
        prompt: 'do it',
        workspace: 'run',
        resultContract: { type: 'object' },
        artifacts: [],
        question: { timeoutMs: 1, escalationGraceMs: 1 }
      },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'agent' },
      { id: 'e2', from: 'agent', to: 'end' }
    ],
    layout: {}
  }
}

beforeEach(() => {
  workflowValidateMock.mockReset()
})

describe('hasBlockingProblemsAfterSave', () => {
  it('returns true from a local structural error, without calling the host', async () => {
    const blocked = await hasBlockingProblemsAfterSave(
      workflowWithUnassignedAgent(),
      context,
      settings,
      'repo-1'
    )

    expect(blocked).toBe(true)
    expect(workflowValidateMock).not.toHaveBeenCalled()
  })

  it('returns false for a locally clean definition when there is no active project to ask', async () => {
    const blocked = await hasBlockingProblemsAfterSave(
      cleanWorkflow(),
      context,
      settings,
      undefined
    )

    expect(blocked).toBe(false)
    expect(workflowValidateMock).not.toHaveBeenCalled()
  })

  it("asks the host for a locally-clean definition and returns true on the host's blocking verdict", async () => {
    workflowValidateMock.mockResolvedValue({
      problems: [
        {
          code: 'graph_skill_source_not_allowlisted',
          message: 'not allowed',
          severity: 'error',
          roleId: 'dev'
        }
      ]
    })

    const blocked = await hasBlockingProblemsAfterSave(cleanWorkflow(), context, settings, 'repo-1')

    expect(blocked).toBe(true)
    expect(workflowValidateMock).toHaveBeenCalledExactlyOnceWith(settings, {
      repo: 'repo-1',
      definition: cleanWorkflow()
    })
  })

  it('returns false when both local and host validation are clean', async () => {
    workflowValidateMock.mockResolvedValue({ problems: [] })

    const blocked = await hasBlockingProblemsAfterSave(cleanWorkflow(), context, settings, 'repo-1')

    expect(blocked).toBe(false)
  })

  it('treats a host validate failure as best-effort clean, matching the debounced host check elsewhere', async () => {
    workflowValidateMock.mockRejectedValue(new Error('offline'))

    const blocked = await hasBlockingProblemsAfterSave(cleanWorkflow(), context, settings, 'repo-1')

    expect(blocked).toBe(false)
  })
})
