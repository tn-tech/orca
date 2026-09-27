// @vitest-environment happy-dom
// Split from AttemptPanel.test.tsx (oxlint max-lines: that file is already near its 800-line cap)
// — US7/FR-034 coverage for a selected Reflection node's role-proposal panel.
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ReflectionNode,
  StartNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import type {
  NodeAttemptView,
  RoleProposalView
} from '../../../../../shared/workflows/workflow-run-types'
import type { WorkflowRunSnapshotView } from '@/runtime/runtime-workflow-client'

const { useWorktreeByIdMock } = vi.hoisted(() => ({ useWorktreeByIdMock: vi.fn() }))

vi.mock('@/store/selectors', () => ({ useWorktreeById: useWorktreeByIdMock }))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { openAllDiffs: () => void }) => unknown) =>
    selector({ openAllDiffs: vi.fn() })
}))

import AttemptPanel from './AttemptPanel'

const settings = { activeRuntimeEnvironmentId: null }

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  useWorktreeByIdMock.mockReturnValue(null)
})

function startNode(): StartNode {
  return { id: 'start', type: 'start', title: 'Start' }
}

function reflectionNode(): ReflectionNode {
  return {
    id: 'reflect',
    type: 'reflection',
    title: 'Reflect',
    prompt: 'Review the run and propose role improvements.'
  }
}

function workflowWithReflection(): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {
      reviewer: {
        id: 'reviewer',
        name: 'Reviewer',
        agent: 'claude',
        systemPrompt: 'Review the change.',
        skills: []
      }
    },
    nodes: [startNode(), reflectionNode()],
    edges: [{ id: 'e1', from: 'start', to: 'reflect' }],
    layout: {}
  }
}

function roleProposal(patch: Partial<RoleProposalView> = {}): RoleProposalView {
  return {
    id: 'proposal-1',
    runId: 'run-1',
    attemptId: 'attempt-1',
    roleId: 'reviewer',
    change: { systemPrompt: 'Review the change and check test coverage.' },
    evidence: 'Missed coverage in three runs.',
    state: 'proposed',
    ...patch
  }
}

function attempt(patch: Partial<NodeAttemptView> = {}): NodeAttemptView {
  return {
    id: 'attempt-1',
    runId: 'run-1',
    nodeId: 'reflect',
    nodeType: 'reflection',
    iteration: 0,
    attemptIndex: 0,
    state: 'completed',
    artifactsJson: [],
    ...patch
  }
}

function snapshot(
  attempts: NodeAttemptView[],
  proposals: RoleProposalView[] = []
): WorkflowRunSnapshotView {
  return {
    id: 'run-1',
    workflowName: 'wf',
    workflowSource: 'project',
    workflowSnapshot: workflowWithReflection(),
    workflowVersion: 'rev-1',
    objective: 'ship it',
    repoId: 'repo-1',
    state: 'running',
    concurrencyLimit: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    attempts,
    proposals,
    questions: [],
    messages: [],
    events: []
  }
}

describe('AttemptPanel — a selected Reflection node (US7, FR-034)', () => {
  it("shows the run's role proposals for this attempt", () => {
    render(
      <AttemptPanel
        definition={workflowWithReflection()}
        snapshot={snapshot(
          [attempt({ id: 'reflect-attempt' })],
          [roleProposal({ attemptId: 'reflect-attempt' })]
        )}
        nodeId="reflect"
        runtimeEnvironmentId={null}
        settings={settings}
      />
    )

    expect(screen.getByText('Role proposals')).toBeInTheDocument()
    expect(screen.getByText('Reviewer')).toBeInTheDocument()
    expect(screen.getByText('Missed coverage in three runs.')).toBeInTheDocument()
  })

  it('only shows proposals recorded for this attempt, not an earlier one', () => {
    render(
      <AttemptPanel
        definition={workflowWithReflection()}
        snapshot={snapshot(
          [attempt({ id: 'reflect-attempt-2' })],
          [roleProposal({ id: 'stale-proposal', attemptId: 'reflect-attempt-1' })]
        )}
        nodeId="reflect"
        runtimeEnvironmentId={null}
        settings={settings}
      />
    )

    expect(screen.queryByText('Role proposals')).not.toBeInTheDocument()
  })

  it('shows no proposals panel when the run recorded none for this node', () => {
    render(
      <AttemptPanel
        definition={workflowWithReflection()}
        snapshot={snapshot([attempt({ id: 'reflect-attempt' })])}
        nodeId="reflect"
        runtimeEnvironmentId={null}
        settings={settings}
      />
    )

    expect(screen.queryByText('Role proposals')).not.toBeInTheDocument()
  })
})
