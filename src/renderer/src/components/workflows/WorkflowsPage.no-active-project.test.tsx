// @vitest-environment happy-dom
// F6: "New workflow" used to silently do nothing without an active project, with no explanation.
// The Workflows view must say so, offer a way to add a project, and pass the same reason down to
// WorkflowListPane so New/Draft show it instead of no-opping.
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'

const { openModalMock } = vi.hoisted(() => ({ openModalMock: vi.fn() }))

/** Not exercised — session.status stays 'empty' in these tests — but the controller's real
 *  session.editor.state.definition is never `{}`, so keep the fake typed as a real Workflow. */
function emptyWorkflow(): Workflow {
  return {
    version: 1,
    name: '',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [],
    edges: [],
    layout: {}
  }
}

vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: {
      settings: { activeRuntimeEnvironmentId: null }
      openModal: typeof openModalMock
    }) => unknown
  ) => selector({ settings: { activeRuntimeEnvironmentId: null }, openModal: openModalMock })
}))

// Irrelevant to the no-project empty state; stub out so this test only exercises the
// session.status === 'empty' branch WorkflowsPage renders.
vi.mock('./editor/NodeInspector', () => ({ default: () => null }))
vi.mock('./editor/ValidationProblemsPanel', () => ({ default: () => null }))
vi.mock('./editor/WorkflowEditorProblemNotice', () => ({ default: () => null }))
vi.mock('./editor/FileConflictDialog', () => ({ default: () => null }))
vi.mock('./WorkflowNameDialog', () => ({ default: () => null }))
vi.mock('./TrustedSourcesDialog', () => ({ default: () => null }))
vi.mock('./run-view/RunCanvasOverlay', () => ({ default: () => null }))
vi.mock('./run-view/RunToolbar', () => ({ default: () => null }))
vi.mock('./run-view/RunControls', () => ({ default: () => null }))
vi.mock('./run-view/RunHistory', () => ({ default: () => null }))

// Stubbed to a minimal render that surfaces the `disabledReason` prop WorkflowsPage passes it,
// without pulling in the real dialogs/list rendering (covered by WorkflowListPane.test.tsx).
vi.mock('./WorkflowListPane', () => ({
  default: (props: { disabledReason?: string }) => (
    <div data-testid="list-pane-disabled-reason">{props.disabledReason ?? ''}</div>
  )
}))

function fakeController(overrides: { repoId?: string; noActiveProjectReason?: string } = {}) {
  const noActiveProjectReason =
    overrides.noActiveProjectReason ?? 'Add or select a project to create workflows.'
  return {
    activeRepo: undefined,
    repoId: overrides.repoId,
    settings: { activeRuntimeEnvironmentId: null },
    allowlistedSources: [],
    list: { rows: [], loading: false, error: null, refresh: vi.fn() },
    session: {
      status: 'empty' as const,
      openRef: null,
      editor: {
        state: {
          definition: emptyWorkflow(),
          manualPositionIds: new Set<string>(),
          history: [],
          dirty: false,
          revision: 0
        },
        dispatch: vi.fn(),
        canUndo: false
      },
      documentRevision: null,
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
    canRun: false,
    noActiveProjectReason: overrides.repoId ? undefined : noActiveProjectReason,
    runDisabledReason: overrides.repoId ? undefined : noActiveProjectReason,
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
  openModalMock.mockReset()
})

describe('WorkflowsPage: no active project (F6)', () => {
  it('explains the no-project state with an action to add one, and passes the reason to the list pane', () => {
    useWorkflowsPageControllerMock.mockReturnValue(fakeController())

    render(<WorkflowsPage />)

    const listPaneReason = screen.getByTestId('list-pane-disabled-reason')
    expect(listPaneReason).toHaveTextContent('Add or select a project to create workflows.')
    expect(
      within(screen.getByRole('main')).getAllByText('Add or select a project to create workflows.')
    ).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Add a project' }))
    expect(openModalMock).toHaveBeenCalledExactlyOnceWith('add-repo')
  })

  it('shows the ordinary placeholder, not the no-project message, once a project is active', () => {
    useWorkflowsPageControllerMock.mockReturnValue(fakeController({ repoId: 'repo-1' }))

    render(<WorkflowsPage />)

    expect(screen.getByText('Select a workflow, or create a new one.')).toBeInTheDocument()
    expect(
      screen.queryByText('Add or select a project to create workflows.')
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('list-pane-disabled-reason')).toHaveTextContent('')
  })
})
