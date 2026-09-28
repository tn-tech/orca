import { afterEach, describe, expect, it } from 'vitest'
import {
  AGENT_READINESS_TIMEOUT_FAILURE_CODE,
  AGENT_READINESS_TIMEOUT_REASON
} from '../../../../../shared/workflows/workflow-attempt-failure-code'
import { OrchestrationDb } from '../orchestration-db'

describe('workflow attempt failureCode', () => {
  let db: OrchestrationDb | undefined
  afterEach(() => db?.close())

  function failedAttempt(failureReason: string) {
    db = new OrchestrationDb(':memory:')
    const run = db.createWorkflowRun({
      workflowName: 'demo',
      workflowSource: 'project',
      workflowSnapshot: {
        version: 1,
        name: 'demo',
        workspacePolicy: 'run-workspace',
        roles: {},
        nodes: [],
        edges: [],
        layout: {}
      },
      workflowVersion: 'v1',
      objective: 'build',
      repoId: 'repo_1',
      worktreeId: 'wt_1'
    })
    const attempt = db.createWorkflowAttempt({ runId: run.id, nodeId: 'n', nodeType: 'agent' })
    return db.updateWorkflowAttempt(attempt.id, { failureReason })
  }

  it('publishes a stable code next to the readiness-timeout text', () => {
    const view = failedAttempt(AGENT_READINESS_TIMEOUT_REASON)

    expect(AGENT_READINESS_TIMEOUT_FAILURE_CODE).toBe('agent_readiness_timeout')
    expect(view?.failureReason).toBe(AGENT_READINESS_TIMEOUT_REASON)
    expect(view?.failureCode).toBe('agent_readiness_timeout')
  })

  it('omits the code for any other failure text', () => {
    const view = failedAttempt('timeout')

    expect(view).not.toHaveProperty('failureCode')
  })
})
