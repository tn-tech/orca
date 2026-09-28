// @vitest-environment happy-dom
// Review round 1 (Important): the run view's "Reload workflow" button (offered on a proposal's
// `workflow_file_conflict`) must never clobber unsaved editor edits. WorkflowsPage.tsx used to wire
// it straight to `session.reloadFromDisk` (unconditional overwrite); it must go through
// `session.checkForExternalChange` instead, which raises the existing conflict dialog when the
// editor is dirty rather than silently discarding the edit.
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  ReflectionNode,
  StartNode,
  Workflow
} from '../../../../shared/workflows/workflow-definition-types'
import type {
  NodeAttemptView,
  RoleProposalView
} from '../../../../shared/workflows/workflow-run-types'
import type { WorkflowRunSnapshotView } from '@/runtime/runtime-workflow-client'

const { workflowProposalAcceptMock } = vi.hoisted(() => ({
  workflowProposalAcceptMock: vi.fn()
}))
vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowProposalAccept: workflowProposalAcceptMock,
  workflowProposalExport: vi.fn()
}))

const { useWorktreeByIdMock } = vi.hoisted(() => ({ useWorktreeByIdMock: vi.fn() }))
vi.mock('@/store/selectors', () => ({ useWorktreeById: useWorktreeByIdMock }))
vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: {
      settings: { activeRuntimeEnvironmentId: null }
      openAllDiffs: () => void
    }) => unknown
  ) => selector({ settings: { activeRuntimeEnvironmentId: null }, openAllDiffs: vi.fn() })
}))

// Everything below is irrelevant to the reload-safety wiring under test — stub it out so this
// test only exercises the real AttemptPanel -> RoleProposalPanel chain WorkflowsPage wires up.
vi.mock('./editor/NodeInspector', () => ({ default: () => null }))
vi.mock('./editor/ValidationProblemsPanel', () => ({ default: () => null }))
vi.mock('./editor/WorkflowEditorProblemNotice', () => ({ default: () => null }))
vi.mock('./editor/FileConflictDialog', () => ({ default: () => null }))
vi.mock('./WorkflowListPane', () => ({ default: () => null }))
vi.mock('./WorkflowNameDialog', () => ({ default: () => null }))
vi.mock('./TrustedSourcesDialog', () => ({ default: () => null }))
vi.mock('./run-view/RunCanvasOverlay', () => ({ default: () => null }))
vi.mock('./run-view/RunToolbar', () => ({ default: () => null }))
vi.mock('./run-view/RunControls', () => ({ default: () => null }))
vi.mock('./run-view/RunHistory', () => ({ default: () => null }))

const { checkForExternalChangeMock, reloadFromDiskMock } = vi.hoisted(() => ({
  checkForExternalChangeMock: vi.fn(),
  reloadFromDiskMock: vi.fn()
}))

function reflectionNode(): ReflectionNode {
  return {
    id: 'reflect',
    type: 'reflection',
    title: 'Reflect',
    prompt: 'Review the run and propose role improvements.'
  }
}

function startNode(): StartNode {
  return { id: 'start', type: 'start', title: 'Start' }
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

function roleProposal(): RoleProposalView {
  return {
    id: 'proposal-1',
    runId: 'run-1',
    attemptId: 'attempt-1',
    roleId: 'reviewer',
    change: { systemPrompt: 'Review the change and check test coverage.' },
    evidence: 'Missed coverage in three runs.',
    state: 'proposed'
  }
}

function attempt(): NodeAttemptView {
  return {
    id: 'attempt-1',
    runId: 'run-1',
    nodeId: 'reflect',
    nodeType: 'reflection',
    iteration: 0,
    attemptIndex: 0,
    state: 'completed',
    artifactsJson: []
  }
}

function snapshot(): WorkflowRunSnapshotView {
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
    attempts: [attempt()],
    proposals: [roleProposal()],
    questions: [],
    messages: [],
    events: []
  }
}

function fakeController(dirty: boolean) {
  return {
    activeRepo: undefined,
    repoId: 'repo-1',
    settings: { activeRuntimeEnvironmentId: null },
    allowlistedSources: [],
    list: { rows: [], loading: false, error: null, refresh: vi.fn() },
    session: {
      status: 'ready' as const,
      openRef: { name: 'wf', source: 'project' as const },
      editor: {
        state: {
          definition: workflowWithReflection(),
          manualPositionIds: new Set<string>(),
          history: [],
          dirty,
          revision: 1
        },
        dispatch: vi.fn(),
        canUndo: false
      },
      documentRevision: 'rev-1',
      saving: false,
      loadError: null,
      conflict: null,
      isDraft: false,
      open: vi.fn(),
      createNew: vi.fn(),
      openDraft: vi.fn(),
      save: vi.fn(),
      saveDraftAs: vi.fn(),
      reloadFromDisk: reloadFromDiskMock,
      overwriteOnDisk: vi.fn(),
      dismissConflict: vi.fn(),
      close: vi.fn(),
      checkForExternalChange: checkForExternalChangeMock
    },
    problems: [],
    canRun: true,
    run: {
      runId: 'run-1',
      snapshot: snapshot(),
      starting: false,
      stopping: false,
      pausing: false,
      resuming: false,
      start: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      openRun: vi.fn()
    },
    selectedNodeId: 'reflect',
    selectedEdgeId: undefined,
    setSelectedNodeId: vi.fn(),
    setSelectedEdgeId: vi.fn(),
    focusProblem: vi.fn(),
    openWorkflow: vi.fn(),
    createWorkflow: vi.fn(),
    duplicateWorkflow: vi.fn(),
    deleteWorkflow: vi.fn(),
    draftWorkflow: vi.fn(),
    openDraft: vi.fn(),
    saveDraft: vi.fn()
  }
}

const { useWorkflowsPageControllerMock } = vi.hoisted(() => ({
  useWorkflowsPageControllerMock: vi.fn()
}))
vi.mock('./use-workflows-page-controller', () => ({
  useWorkflowsPageController: useWorkflowsPageControllerMock
}))

import WorkflowsPage from './WorkflowsPage'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  useWorktreeByIdMock.mockReturnValue(null)
  workflowProposalAcceptMock.mockReset()
  checkForExternalChangeMock.mockReset()
  reloadFromDiskMock.mockReset()
})

describe('WorkflowsPage: role-proposal "Reload workflow" never clobbers unsaved edits', () => {
  it('routes the conflict-banner reload through checkForExternalChange, not the raw discard, while the editor is dirty', async () => {
    workflowProposalAcceptMock.mockRejectedValue(new Error('workflow_file_conflict'))
    useWorkflowsPageControllerMock.mockReturnValue(fakeController(true))

    render(
      <TooltipProvider>
        <WorkflowsPage />
      </TooltipProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.getByText(/changed on disk/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Reload workflow' }))

    expect(checkForExternalChangeMock).toHaveBeenCalled()
    expect(reloadFromDiskMock).not.toHaveBeenCalled()
  })
})
