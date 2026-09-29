// @vitest-environment happy-dom
// F9: leaving a shown run for editing, and run-level pending prompts.
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { WorkflowRunSnapshotView } from '@/runtime/runtime-workflow-client'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { activeRuntimeEnvironmentId: null }, openModal: vi.fn() })
}))
vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowRunAnswer: vi.fn(),
  workflowTrustDecide: vi.fn()
}))
vi.mock('./editor/AddNodeMenu', () => ({ default: () => null }))
vi.mock('./editor/WrapInLoopButton', () => ({ default: () => null }))
vi.mock('./editor/UndoButton', () => ({ default: () => null }))
vi.mock('./editor/NodeInspector', () => ({
  default: (props: { selectedNodeId?: string }) => (
    <div data-testid="node-inspector">{props.selectedNodeId}</div>
  )
}))
vi.mock('./run-view/AttemptPanel', () => ({
  default: () => <div data-testid="attempt-panel" />
}))
vi.mock('./editor/ValidationProblemsPanel', () => ({ default: () => null }))
vi.mock('./editor/WorkflowEditorProblemNotice', () => ({ default: () => null }))
vi.mock('./editor/FileConflictDialog', () => ({ default: () => null }))
vi.mock('./WorkflowListPane', () => ({ default: () => null }))
vi.mock('./WorkflowNameDialog', () => ({ default: () => null }))
vi.mock('./TrustedSourcesDialog', () => ({ default: () => null }))
vi.mock('./RunHistoryButton', () => ({ default: () => null }))
vi.mock('./run-view/RunCanvasOverlay', () => ({ default: () => null }))
vi.mock('./run-view/RunControls', () => ({ default: () => null }))
vi.mock('./run-view/RunHistory', () => ({ default: () => null }))

const definition: Workflow = {
  version: 1,
  name: 'wf',
  workspacePolicy: 'run-workspace',
  roles: {},
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    {
      id: 'gate',
      type: 'approval',
      title: 'Ship gate',
      question: 'Ship?',
      options: ['yes'],
      timeoutMs: 1000,
      escalationGraceMs: 1000
    },
    { id: 'end', type: 'end', title: 'End' }
  ],
  edges: [],
  layout: {}
}

const snapshot: WorkflowRunSnapshotView = {
  id: 'run-1',
  workflowName: 'wf',
  workflowSource: 'project',
  workflowSnapshot: definition,
  workflowVersion: 'rev-1',
  objective: 'ship',
  repoId: 'repo-1',
  state: 'waiting',
  concurrencyLimit: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  attempts: [
    {
      id: 'attempt-1',
      runId: 'run-1',
      nodeId: 'gate',
      nodeType: 'approval',
      iteration: 0,
      attemptIndex: 0,
      state: 'waiting',
      artifactsJson: []
    }
  ],
  questions: [
    {
      id: 'q-1',
      runId: 'run-1',
      attemptId: 'attempt-1',
      kind: 'approval',
      prompt: 'Ship it to production?',
      optionsJson: { choices: [{ id: 'yes', label: 'Yes' }] },
      state: 'pending'
    }
  ],
  messages: [],
  events: []
}

function fakeController(shown: WorkflowRunSnapshotView | null, selectedNodeId?: string) {
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
          definition,
          manualPositionIds: new Set<string>(),
          history: [],
          dirty: false,
          revision: 0,
          lastProblem: null
        },
        dispatch: vi.fn(),
        canUndo: false
      },
      documentRevision: 'rev-1',
      saving: false,
      loadError: null,
      conflict: null,
      isDraft: false,
      save: vi.fn(),
      checkForExternalChange: vi.fn()
    },
    problems: [],
    canRun: true,
    noActiveProjectReason: undefined,
    runDisabledReason: undefined,
    run: {
      runId: shown ? 'run-1' : null,
      snapshot: shown,
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
    backToEditing: vi.fn(),
    selectedNodeId,
    selectedEdgeId: undefined,
    setSelectedNodeId: vi.fn(),
    setSelectedEdgeId: vi.fn()
  }
}

const { useWorkflowsPageControllerMock } = vi.hoisted(() => ({
  useWorkflowsPageControllerMock: vi.fn()
}))
vi.mock('./use-workflows-page-controller', () => ({
  useWorkflowsPageController: useWorkflowsPageControllerMock
}))

import WorkflowsPage from './WorkflowsPage'

afterEach(cleanup)

function renderPage(): void {
  render(
    <TooltipProvider>
      <WorkflowsPage />
    </TooltipProvider>
  )
}

describe('WorkflowsPage: leaving a run and run-level prompts (F9)', () => {
  it('shows a pending question at run level with no node selected', () => {
    useWorkflowsPageControllerMock.mockReturnValue(fakeController(snapshot))

    renderPage()

    expect(screen.getByText('Ship it to production?')).toBeInTheDocument()
  })

  it('Back to editing calls the controller while a run is shown', () => {
    const controller = fakeController(snapshot)
    useWorkflowsPageControllerMock.mockReturnValue(controller)

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Back to editing' }))

    expect(controller.backToEditing).toHaveBeenCalledTimes(1)
  })

  it('shows node settings, no attempt panel, banner or Back button once the run is dropped', () => {
    useWorkflowsPageControllerMock.mockReturnValue(fakeController(null, 'gate'))

    renderPage()

    expect(screen.getByTestId('node-inspector')).toHaveTextContent('gate')
    expect(screen.queryByTestId('attempt-panel')).toBeNull()
    expect(screen.queryByText('Ship it to production?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back to editing' })).toBeNull()
  })

  it('shows the attempt panel instead of settings while the run is shown and a node is selected', () => {
    useWorkflowsPageControllerMock.mockReturnValue(fakeController(snapshot, 'gate'))

    renderPage()

    expect(screen.getByTestId('attempt-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('node-inspector')).toBeNull()
  })
})
