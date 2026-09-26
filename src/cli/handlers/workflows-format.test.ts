import { describe, expect, it } from 'vitest'
import type { Workflow } from '../../shared/workflows/workflow-definition-types'
import type {
  NodeAttemptView,
  RunEventView,
  RunQuestionView,
  RunSnapshot
} from '../../shared/workflows/workflow-run-types'
import {
  formatWorkflowList,
  formatWorkflowRunEventLine,
  formatWorkflowRunList,
  formatWorkflowRunStart,
  formatWorkflowRunStatus,
  formatWorkflowShow,
  formatWorkflowValidate
} from './workflows-format'

function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    version: 1,
    name: 'release-review',
    workspacePolicy: 'run-workspace',
    nodes: [{ id: 'start', type: 'start', title: 'Start' }],
    edges: [],
    layout: {},
    roles: {},
    ...overrides
  }
}

function runSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    id: 'run-1',
    workflowName: 'release-review',
    workflowSource: 'project',
    workflowSnapshot: workflow(),
    workflowVersion: 'rev-1',
    objective: 'Ship it',
    repoId: 'repo-1',
    state: 'running',
    concurrencyLimit: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('formatWorkflowList', () => {
  it('reports no workflows found for an empty list', () => {
    expect(formatWorkflowList({ workflows: [] })).toBe('No workflows found.')
  })

  it('lists each workflow with its source, validity, path, and description', () => {
    const output = formatWorkflowList({
      workflows: [
        {
          name: 'release-review',
          source: 'project',
          path: '/repo/.orca/workflows/release-review.yaml',
          description: 'Reviews a release',
          valid: true
        },
        { name: 'broken', source: 'personal', path: '/home/me/broken.yaml', valid: false }
      ]
    })
    expect(output).toContain('release-review  project  valid')
    expect(output).toContain('/repo/.orca/workflows/release-review.yaml')
    expect(output).toContain('Reviews a release')
    expect(output).toContain('broken  personal  invalid')
  })
})

describe('formatWorkflowShow', () => {
  it('prints the parsed definition, its nodes/edges/roles, and the revision', () => {
    const output = formatWorkflowShow({
      definition: workflow({
        description: 'Reviews a release',
        nodes: [
          { id: 'start', type: 'start', title: 'Start' },
          { id: 'end', type: 'end', title: 'End' }
        ],
        edges: [{ id: 'e1', from: 'start', to: 'end' }],
        roles: {
          reviewer: {
            id: 'reviewer',
            name: 'Reviewer',
            agent: 'claude',
            systemPrompt: 'Review',
            skills: []
          }
        }
      }),
      raw: 'version: 1',
      revision: 'rev-1',
      problems: []
    })
    expect(output).toContain('revision: rev-1')
    expect(output).toContain('name: release-review')
    expect(output).toContain('description: Reviews a release')
    expect(output).toContain('start  start  Start')
    expect(output).toContain('start -> end')
    expect(output).toContain('reviewer  claude')
    expect(output).not.toContain('problems:')
  })

  it('reports an unparsed definition with its problems instead of crashing', () => {
    const output = formatWorkflowShow({
      definition: undefined,
      raw: 'not a workflow',
      revision: 'rev-1',
      problems: [
        { code: 'workflow_file_version_unsupported', message: 'bad version', severity: 'error' }
      ]
    })
    expect(output).toContain('definition: (unparsed')
    expect(output).toContain('[error] workflow_file_version_unsupported: bad version')
  })
})

describe('formatWorkflowValidate', () => {
  it('reports no problems found when the workflow is clean', () => {
    expect(formatWorkflowValidate({ problems: [] })).toBe('No problems found.')
  })

  it('prints each problem with its severity, code, message, and location', () => {
    const output = formatWorkflowValidate({
      problems: [
        {
          code: 'graph_cycle',
          message: 'Cycle detected',
          nodeId: 'n1',
          severity: 'error'
        }
      ]
    })
    expect(output).toBe('  [error] graph_cycle: Cycle detected (node=n1)')
  })
})

describe('formatWorkflowRunStart', () => {
  it('names the started run', () => {
    expect(formatWorkflowRunStart({ runId: 'run-1' })).toBe('Started workflow run run-1.')
  })
})

describe('formatWorkflowRunList', () => {
  it('reports no runs found for an empty list', () => {
    expect(formatWorkflowRunList({ runs: [] })).toBe('No workflow runs found.')
  })

  it('lists each run and appends a cursor when paginated', () => {
    const output = formatWorkflowRunList({
      runs: [
        {
          id: 'run-1',
          workflowName: 'release-review',
          workflowSource: 'project',
          workflowVersion: 'rev-1',
          objective: 'Ship it',
          repoId: 'repo-1',
          state: 'completed',
          concurrencyLimit: 1,
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      nextCursor: 'cursor-2'
    })
    expect(output).toContain('run-1  release-review  completed  2026-01-01T00:00:00.000Z')
    expect(output).toContain('nextCursor: cursor-2')
  })
})

describe('formatWorkflowRunStatus', () => {
  it('prints run fields, attempts, and only pending questions', () => {
    const attempts: NodeAttemptView[] = [
      {
        id: 'attempt-1',
        runId: 'run-1',
        nodeId: 'review',
        nodeType: 'agent',
        iteration: 0,
        attemptIndex: 0,
        state: 'failed',
        artifactsJson: [],
        failureReason: 'timeout'
      }
    ]
    const questions: RunQuestionView[] = [
      {
        id: 'q-1',
        runId: 'run-1',
        attemptId: 'attempt-1',
        kind: 'approval',
        prompt: 'Approve?',
        optionsJson: [],
        state: 'pending'
      },
      {
        id: 'q-2',
        runId: 'run-1',
        attemptId: 'attempt-1',
        kind: 'approval',
        prompt: 'Already answered',
        optionsJson: [],
        state: 'answered'
      }
    ]
    const output = formatWorkflowRunStatus({
      ...runSnapshot({ state: 'failed' }),
      attempts,
      questions,
      events: []
    })
    expect(output).toContain('id: run-1')
    expect(output).toContain('state: failed')
    expect(output).toContain('review (iteration 0)  failed  failure=timeout')
    expect(output).toContain('q-1  approval  Approve?')
    expect(output).not.toContain('Already answered')
  })
})

describe('formatWorkflowRunEventLine', () => {
  it('formats a run-scoped event with its payload', () => {
    const event: RunEventView = {
      id: '1',
      runId: 'run-1',
      kind: 'run_started',
      payloadJson: { state: 'running' },
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    expect(formatWorkflowRunEventLine(event)).toBe(
      '2026-01-01T00:00:00.000Z  run  run_started  state=running'
    )
  })

  it('formats an attempt-scoped event by its attempt id', () => {
    const event: RunEventView = {
      id: '2',
      runId: 'run-1',
      attemptId: 'attempt-1',
      kind: 'attempt_running',
      payloadJson: { nodeId: 'review', iteration: 0, state: 'running' },
      createdAt: '2026-01-01T00:00:01.000Z'
    }
    expect(formatWorkflowRunEventLine(event)).toBe(
      '2026-01-01T00:00:01.000Z  attempt attempt-1  attempt_running  nodeId=review iteration=0 state=running'
    )
  })
})
