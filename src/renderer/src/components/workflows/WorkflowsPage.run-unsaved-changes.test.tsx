// @vitest-environment happy-dom
// F8: pressing Run while the editor has unsaved edits used to silently run the on-disk file. Run
// must instead ask "Save and run" / "Cancel", abort on a failed save, and still respect a
// blocking validation problem once the save lands (F7 semantics).
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

// Irrelevant to the run/save-guard wiring under test.
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
// A minimal stand-in that calls the real `onRun` (WorkflowsPage's run-save guard), skipping
// RunToolbar's own objective input/tooltip — those are covered by RunToolbar's own tests.
vi.mock('./run-view/RunToolbar', () => ({
  default: (props: { onRun: (objective: string) => void }) => (
    <button type="button" onClick={() => props.onRun('add tests')}>
      Run
    </button>
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

type FakeState = { dirty: boolean; saving: boolean; save: () => Promise<boolean> }

function fakeController(state: FakeState, start: (objective: string) => Promise<void>) {
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
          definition: readyWorkflow(),
          manualPositionIds: new Set<string>(),
          history: [],
          dirty: state.dirty,
          revision: 0,
          lastProblem: null
        },
        dispatch: vi.fn(),
        canUndo: false
      },
      documentRevision: 'rev-1',
      saving: state.saving,
      loadError: null,
      conflict: null,
      isDraft: false,
      open: vi.fn(),
      createNew: vi.fn(),
      openDraft: vi.fn(),
      save: state.save,
      saveDraftAs: vi.fn(),
      reloadFromDisk: vi.fn(),
      overwriteOnDisk: vi.fn(),
      dismissConflict: vi.fn(),
      close: vi.fn(),
      checkForExternalChange: vi.fn()
    },
    problems: [],
    canRun: true,
    noActiveProjectReason: undefined,
    runDisabledReason: undefined,
    run: {
      runId: null,
      snapshot: null,
      starting: false,
      stopping: false,
      pausing: false,
      resuming: false,
      start,
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

function renderPage(state: FakeState, start: (objective: string) => Promise<void>) {
  useWorkflowsPageControllerMock.mockImplementation(() => fakeController(state, start))
  return render(
    <TooltipProvider>
      <WorkflowsPage />
    </TooltipProvider>
  )
}

describe('WorkflowsPage: Run while dirty (F8)', () => {
  it('clean: runs immediately with no prompt', () => {
    const start = vi.fn(async () => {})
    renderPage({ dirty: false, saving: false, save: vi.fn() }, start)

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(start).toHaveBeenCalledExactlyOnceWith('add tests')
    expect(screen.queryByText('Save before running?')).not.toBeInTheDocument()
  })

  it('dirty: prompts, then saves and runs the saved revision on "Save and run"', async () => {
    const state: FakeState = {
      dirty: true,
      saving: false,
      save: vi.fn(async () => {
        state.dirty = false
        return true
      })
    }
    const start = vi.fn(async () => {})
    const { rerender } = renderPage(state, start)

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText('Save before running?')).toBeInTheDocument()
    expect(start).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save and run' }))
    expect(state.save).toHaveBeenCalledTimes(1)

    // The real session hook would re-render with the now-clean state itself; this fake session
    // isn't React state, so re-render explicitly once the save (mutated above) has settled.
    rerender(
      <TooltipProvider>
        <WorkflowsPage />
      </TooltipProvider>
    )

    await waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith('add tests'))
    expect(screen.queryByText('Save before running?')).not.toBeInTheDocument()
  })

  it('dirty: a failed save aborts the run', async () => {
    const state: FakeState = {
      dirty: true,
      saving: false,
      save: vi.fn(async () => false)
    }
    const start = vi.fn(async () => {})
    const { rerender } = renderPage(state, start)

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText('Save before running?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save and run' }))
    expect(state.save).toHaveBeenCalledTimes(1)

    rerender(
      <TooltipProvider>
        <WorkflowsPage />
      </TooltipProvider>
    )

    // Nothing to waitFor (start should never be called) — flush the microtask queue instead.
    await Promise.resolve()
    await Promise.resolve()
    expect(start).not.toHaveBeenCalled()
  })

  it('dirty: Cancel keeps editing without saving or running', async () => {
    const state: FakeState = { dirty: true, saving: false, save: vi.fn() }
    const start = vi.fn(async () => {})
    renderPage(state, start)

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText('Save before running?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(state.save).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(screen.queryByText('Save before running?')).not.toBeInTheDocument()
  })

  it('dirty: Escape keeps editing without saving or running (keyboard accessible)', async () => {
    const state: FakeState = { dirty: true, saving: false, save: vi.fn() }
    const start = vi.fn(async () => {})
    renderPage(state, start)

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByText('Save before running?')).not.toBeInTheDocument())
    expect(state.save).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })
})
