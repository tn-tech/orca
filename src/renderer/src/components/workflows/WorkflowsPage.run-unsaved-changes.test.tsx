// @vitest-environment happy-dom
// F8: pressing Run while the editor has unsaved edits used to silently run the on-disk file. Run
// must instead ask "Save and run" / "Cancel", abort on a failed save, still respect a blocking
// validation problem once the save lands (F7 semantics), and — fix round 1 — never stack its own
// prompt on top of a real file conflict: FileConflictDialog always wins, and Run never proceeds
// through a conflict.
import '@testing-library/jest-dom/vitest'
import type { ReactElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'
import type { WorkflowFileConflictReason } from './editor/FileConflictDialog'

const { workflowValidateMock } = vi.hoisted(() => ({ workflowValidateMock: vi.fn() }))
vi.mock('@/runtime/runtime-workflow-client', () => ({ workflowValidate: workflowValidateMock }))

vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: {
      settings: { activeRuntimeEnvironmentId: null }
      openModal: () => void
    }) => unknown
  ) => selector({ settings: { activeRuntimeEnvironmentId: null }, openModal: vi.fn() })
}))

// Irrelevant to the run/save-guard wiring under test. FileConflictDialog is deliberately left
// real (not mocked) so the conflict-coordination tests exercise the actual competing-modal case.
vi.mock('./editor/AddNodeMenu', () => ({ default: () => null }))
vi.mock('./editor/WrapInLoopButton', () => ({ default: () => null }))
vi.mock('./editor/UndoButton', () => ({ default: () => null }))
vi.mock('./editor/NodeInspector', () => ({ default: () => null }))
vi.mock('./editor/ValidationProblemsPanel', () => ({ default: () => null }))
vi.mock('./editor/WorkflowEditorProblemNotice', () => ({ default: () => null }))
vi.mock('./WorkflowListPane', () => ({ default: () => null }))
vi.mock('./WorkflowNameDialog', () => ({ default: () => null }))
vi.mock('./TrustedSourcesDialog', () => ({ default: () => null }))
vi.mock('./RunHistoryButton', () => ({ default: () => null }))
vi.mock('./run-view/RunCanvasOverlay', () => ({ default: () => null }))
vi.mock('./run-view/RunControls', () => ({ default: () => null }))
vi.mock('./run-view/RunHistory', () => ({ default: () => null }))
// A minimal stand-in that calls the real `onRun` (WorkflowsPage's run-save guard) and reflects
// `canRun`/`disabledReason` as a native `disabled` button plus its reason text, so the busy-state
// tests can assert on both without re-testing RunToolbar's own objective input/tooltip (covered by
// RunToolbar's own tests).
vi.mock('./run-view/RunToolbar', () => ({
  default: (props: {
    onRun: (objective: string) => void
    canRun: boolean
    disabledReason?: string
  }) => (
    <div>
      <div data-testid="run-disabled-reason">{props.disabledReason ?? ''}</div>
      <button
        type="button"
        data-testid="run-button"
        disabled={!props.canRun}
        onClick={() => props.canRun && props.onRun('add tests')}
      >
        Run
      </button>
    </div>
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

type FakeState = {
  dirty: boolean
  saving: boolean
  save: () => Promise<boolean>
  conflict: WorkflowFileConflictReason | null
}

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
      conflict: state.conflict,
      isDraft: false,
      open: vi.fn(),
      createNew: vi.fn(),
      openDraft: vi.fn(),
      save: state.save,
      saveDraftAs: vi.fn(),
      reloadFromDisk: vi.fn(async () => {
        state.conflict = null
        state.dirty = false
      }),
      overwriteOnDisk: vi.fn(async () => {
        state.conflict = null
      }),
      dismissConflict: vi.fn(() => {
        state.conflict = null
      }),
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

beforeEach(() => {
  workflowValidateMock.mockReset()
  workflowValidateMock.mockResolvedValue({ problems: [] })
})

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

function rerenderPage(rerender: (ui: ReactElement) => void) {
  rerender(
    <TooltipProvider>
      <WorkflowsPage />
    </TooltipProvider>
  )
}

describe('WorkflowsPage: Run while dirty (F8)', () => {
  it('clean: runs immediately with no prompt', () => {
    const start = vi.fn(async () => {})
    renderPage({ dirty: false, saving: false, save: vi.fn(), conflict: null }, start)

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(start).toHaveBeenCalledExactlyOnceWith('add tests')
    expect(screen.queryByText('Save before running?')).not.toBeInTheDocument()
  })

  it('dirty: prompts, then saves and runs the saved revision on "Save and run"', async () => {
    const state: FakeState = {
      dirty: true,
      saving: false,
      conflict: null,
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
    rerenderPage(rerender)

    await waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith('add tests'))
    expect(screen.queryByText('Save before running?')).not.toBeInTheDocument()
  })

  it('dirty: a failed save aborts the run', async () => {
    const state: FakeState = {
      dirty: true,
      saving: false,
      conflict: null,
      save: vi.fn(async () => false)
    }
    const start = vi.fn(async () => {})
    const { rerender } = renderPage(state, start)

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText('Save before running?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save and run' }))
    expect(state.save).toHaveBeenCalledTimes(1)

    rerenderPage(rerender)

    // Nothing to waitFor (start should never be called) — flush the microtask queue instead.
    await Promise.resolve()
    await Promise.resolve()
    expect(start).not.toHaveBeenCalled()
  })

  it('dirty: Cancel keeps editing without saving or running', async () => {
    const state: FakeState = { dirty: true, saving: false, conflict: null, save: vi.fn() }
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
    const state: FakeState = { dirty: true, saving: false, conflict: null, save: vi.fn() }
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

describe('WorkflowsPage: Run vs. file conflict coordination (F8 fix round 1)', () => {
  it('a conflict arising while the prompt is open closes it and hands off to FileConflictDialog, with no stacked modal', async () => {
    const state: FakeState = { dirty: true, saving: false, conflict: null, save: vi.fn() }
    const start = vi.fn(async () => {})
    const { rerender } = renderPage(state, start)

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText('Save before running?')).toBeInTheDocument()

    // The external-change watcher raises a conflict while our prompt is still open.
    state.conflict = 'external'
    rerenderPage(rerender)

    expect(screen.queryByText('Save before running?')).not.toBeInTheDocument()
    expect(await screen.findByText('This workflow changed on disk')).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(state.save).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()

    // The user resolves it ("Keep editing" — dismissConflict); the stale prompt must not silently
    // reappear, and Run has to be pressed again.
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    rerenderPage(rerender)

    expect(screen.queryByText('Save before running?')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(start).not.toHaveBeenCalled()
  })

  it('a conflict detected during the save itself aborts the run and hands off to FileConflictDialog', async () => {
    const state: FakeState = {
      dirty: true,
      saving: false,
      conflict: null,
      save: vi.fn(async () => {
        // Mirrors the real session: workflow_file_conflict during workflowWrite sets `conflict`
        // and resolves `save()` to false, never touching `dirty`.
        state.conflict = 'save'
        return false
      })
    }
    const start = vi.fn(async () => {})
    const { rerender } = renderPage(state, start)

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText('Save before running?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save and run' }))
    rerenderPage(rerender)

    expect(await screen.findByText('This workflow changed on disk')).toBeInTheDocument()
    expect(screen.queryByText('Save before running?')).not.toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(start).not.toHaveBeenCalled()
  })

  it('a conflict already present when Run is pressed never opens the prompt', () => {
    const state: FakeState = { dirty: true, saving: false, conflict: 'external', save: vi.fn() }
    const start = vi.fn(async () => {})
    renderPage(state, start)

    expect(screen.getByText('This workflow changed on disk')).toBeInTheDocument()

    // The real modal overlay makes this unreachable by role/pointer, but the guard's own logic
    // must refuse regardless — reach the DOM node directly to prove that defense in depth.
    fireEvent.click(screen.getByTestId('run-button'))

    expect(screen.queryByText('Save before running?')).not.toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(state.save).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })
})

describe('WorkflowsPage: Run busy state during save-then-run (F8 fix round 1)', () => {
  it('disables Run with a "Saving…" reason during save-then-run, so a second click is a no-op', async () => {
    let resolveSave!: (ok: boolean) => void
    const savePromise = new Promise<boolean>((resolve) => {
      resolveSave = resolve
    })
    const state: FakeState = {
      dirty: true,
      saving: false,
      conflict: null,
      save: vi.fn(() => savePromise)
    }
    const start = vi.fn(async () => {})
    const { rerender } = renderPage(state, start)

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText('Save before running?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save and run' }))
    rerenderPage(rerender)

    expect(screen.getByTestId('run-disabled-reason')).toHaveTextContent('Saving…')
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()

    // A second click while busy/disabled must not fire a second save or reopen the prompt.
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(state.save).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Save before running?')).not.toBeInTheDocument()

    await waitFor(async () => {
      resolveSave(true)
      state.dirty = false
      await savePromise
    })
    rerenderPage(rerender)

    await waitFor(() => expect(screen.getByTestId('run-disabled-reason')).toHaveTextContent(''))
    expect(start).toHaveBeenCalledExactlyOnceWith('add tests')
  })
})
