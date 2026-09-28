// @vitest-environment happy-dom
// F6 added `controller.runDisabledReason` (no-project reason takes priority over draft/blocking
// problems). WorkflowsPage must pass it straight through to RunToolbar's `disabledReason` — this
// pins that wiring, which the other WorkflowsPage tests don't cover (they mock RunToolbar to
// `() => null` since it's irrelevant to what they test).
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'

vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: {
      settings: { activeRuntimeEnvironmentId: null }
      openModal: () => void
    }) => unknown
  ) => selector({ settings: { activeRuntimeEnvironmentId: null }, openModal: vi.fn() })
}))

vi.mock('./editor/AddNodeMenu', () => ({ default: () => null }))
vi.mock('./editor/WrapInLoopButton', () => ({ default: () => null }))
vi.mock('./editor/UndoButton', () => ({ default: () => null }))
vi.mock('./editor/NodeInspector', () => ({ default: () => null }))
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
// The stub under test: renders the exact `disabledReason` prop text so the assertion is a plain
// text query, matching this file's other mocks' style.
vi.mock('./run-view/RunToolbar', () => ({
  default: (props: { disabledReason?: string }) => (
    <div data-testid="run-toolbar-disabled-reason">{props.disabledReason ?? ''}</div>
  )
}))

function readyWorkflow(): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [{ id: 'edge-1', from: 'start', to: 'end' }],
    layout: {}
  }
}

function fakeController(overrides: { repoId?: string; runDisabledReason?: string } = {}) {
  return {
    activeRepo: undefined,
    repoId: overrides.repoId ?? 'repo-1',
    settings: { activeRuntimeEnvironmentId: null },
    allowlistedSources: [],
    list: { rows: [], loading: false, error: null, refresh: vi.fn() },
    session: {
      status: 'ready' as const,
      openRef: { name: 'wf', source: 'project' as const },
      editor: {
        state: {
          definition: readyWorkflow(),
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
      open: vi.fn(),
      createNew: vi.fn(),
      openDraft: vi.fn(),
      save: vi.fn(),
      saveDraftAs: vi.fn(),
      reloadFromDisk: vi.fn(),
      overwriteOnDisk: vi.fn(),
      dismissConflict: vi.fn(),
      close: vi.fn(),
      checkForExternalChange: vi.fn()
    },
    problems: [],
    canRun: overrides.runDisabledReason === undefined,
    noActiveProjectReason: overrides.repoId ? undefined : 'Add or select a project.',
    runDisabledReason: overrides.runDisabledReason,
    run: {
      runId: null,
      snapshot: null,
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
    selectedNodeId: undefined,
    selectedEdgeId: undefined,
    setSelectedNodeId: vi.fn(),
    setSelectedEdgeId: vi.fn(),
    focusProblem: vi.fn(),
    openWorkflow: vi.fn(),
    createWorkflow: vi.fn(),
    duplicateWorkflow: vi.fn(),
    addNode: vi.fn(),
    deleteWorkflow: vi.fn(),
    draftWorkflow: vi.fn(),
    openDraft: vi.fn(),
    saveDraft: vi.fn(),
    deleteNode: vi.fn(),
    deleteEdge: vi.fn(),
    deleteSelection: vi.fn(),
    unwrapLoop: vi.fn(),
    undo: vi.fn()
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

describe('WorkflowsPage: Run disabled-reason wiring (F5 fix round 1)', () => {
  it('passes controller.runDisabledReason straight through to RunToolbar', () => {
    useWorkflowsPageControllerMock.mockReturnValue(
      fakeController({ repoId: undefined, runDisabledReason: 'Add or select a project.' })
    )

    render(
      <TooltipProvider>
        <WorkflowsPage />
      </TooltipProvider>
    )

    expect(screen.getByTestId('run-toolbar-disabled-reason')).toHaveTextContent(
      'Add or select a project.'
    )
  })

  it('passes no reason through once a project is active and nothing else blocks Run', () => {
    useWorkflowsPageControllerMock.mockReturnValue(fakeController())

    render(
      <TooltipProvider>
        <WorkflowsPage />
      </TooltipProvider>
    )

    expect(screen.getByTestId('run-toolbar-disabled-reason')).toHaveTextContent('')
  })
})
