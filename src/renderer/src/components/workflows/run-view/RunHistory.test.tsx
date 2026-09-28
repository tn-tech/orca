// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  AgentNode,
  LoopNode,
  StartNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import type {
  NodeAttemptView,
  RunSummary
} from '../../../../../shared/workflows/workflow-run-types'
import type { WorkflowRunSnapshotView } from '@/runtime/runtime-workflow-client'

const { workflowRunListMock, workflowRunShowMock, workflowRunRerunMock } = vi.hoisted(() => ({
  workflowRunListMock: vi.fn(),
  workflowRunShowMock: vi.fn(),
  workflowRunRerunMock: vi.fn()
}))
vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowRunList: workflowRunListMock,
  workflowRunShow: workflowRunShowMock,
  workflowRunRerun: workflowRunRerunMock
}))

vi.mock('@/i18n/relative-time-format', () => ({
  formatUiRelativeTimeFromDate: () => '2 minutes ago'
}))

import RunHistory from './RunHistory'

const settings = { activeRuntimeEnvironmentId: null }

function startNode(): StartNode {
  return { id: 'start', type: 'start', title: 'Start' }
}

function agentNode(id: string, title: string): AgentNode {
  return {
    id,
    type: 'agent',
    title,
    prompt: 'do it',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 1, escalationGraceMs: 1 }
  }
}

function workflow(): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [startNode(), agentNode('implement', 'Implement')],
    edges: [{ id: 'e1', from: 'start', to: 'implement' }],
    layout: {}
  }
}

function loopNode(): LoopNode {
  return {
    id: 'loop',
    type: 'loop',
    title: 'Loop',
    body: { nodeIds: ['implement'] },
    entryNodeId: 'implement',
    exitNodeId: 'implement',
    maxIterations: 3,
    exitCondition: { path: 'approved', op: 'truthy' },
    onCapReached: 'fail'
  }
}

function workflowWithLoop(): Workflow {
  return { ...workflow(), nodes: [startNode(), loopNode(), agentNode('implement', 'Implement')] }
}

function runSummary(patch: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    workflowName: 'wf',
    workflowSource: 'project',
    workflowVersion: 'rev-1',
    objective: 'Ship it',
    repoId: 'repo-1',
    state: 'completed',
    concurrencyLimit: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:30.000Z',
    ...patch
  }
}

function attempt(patch: Partial<NodeAttemptView> = {}): NodeAttemptView {
  return {
    id: 'attempt-1',
    runId: 'run-1',
    nodeId: 'implement',
    nodeType: 'agent',
    iteration: 0,
    attemptIndex: 0,
    state: 'failed',
    artifactsJson: [],
    ...patch
  }
}

function runDetail(patch: Partial<WorkflowRunSnapshotView> = {}): WorkflowRunSnapshotView {
  return {
    id: 'run-1',
    workflowName: 'wf',
    workflowSource: 'project',
    workflowSnapshot: workflow(),
    workflowVersion: 'rev-1',
    objective: 'Ship it',
    repoId: 'repo-1',
    state: 'failed',
    concurrencyLimit: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    attempts: [attempt()],
    questions: [],
    messages: [],
    events: [],
    ...patch
  }
}

function renderHistory(onOpenRun = vi.fn()) {
  return render(
    <TooltipProvider>
      <RunHistory
        settings={settings}
        repoId="repo-1"
        name="wf"
        source="project"
        onOpenRun={onOpenRun}
      />
    </TooltipProvider>
  )
}

beforeEach(() => {
  workflowRunListMock.mockReset()
  workflowRunShowMock.mockReset()
  workflowRunRerunMock.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('RunHistory', () => {
  it('lists past runs with their outcome and duration', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary()] })

    renderHistory()

    await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument())
    expect(screen.getByText('2 minutes ago')).toBeInTheDocument()
    expect(screen.getByText('1m 30s')).toBeInTheDocument()
    expect(workflowRunListMock).toHaveBeenCalledWith(settings, { repo: 'repo-1', name: 'wf' })
  })

  it('shows an empty message when the workflow has never run', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [] })

    renderHistory()

    await waitFor(() => expect(screen.getByText(/no runs yet/i)).toBeInTheDocument())
  })

  it('surfaces a list-fetch error', async () => {
    workflowRunListMock.mockRejectedValue(new Error('host unreachable'))

    renderHistory()

    await waitFor(() => expect(screen.getByText('host unreachable')).toBeInTheDocument())
  })

  it('opens a run when its Open action is clicked', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary()] })
    const onOpenRun = vi.fn()

    renderHistory(onOpenRun)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(onOpenRun).toHaveBeenCalledWith('run-1')
  })

  it('expands a run to show per-node outcomes, fetched from workflow.run.show', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary({ state: 'failed' })] })
    workflowRunShowMock.mockResolvedValue(runDetail())

    renderHistory()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))

    expect(workflowRunShowMock).toHaveBeenCalledWith(settings, 'run-1')
    const nodeTitle = await screen.findByText('Implement')
    const nodeRow = nodeTitle.closest('li')
    if (!nodeRow) {
      throw new Error('expected the node title to sit inside a row')
    }
    expect(within(nodeRow).getByText('Failed')).toBeInTheDocument()
  })

  it('offers "Rerun from this node" only for a node whose latest attempt failed, in a failed run', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary({ state: 'failed' })] })
    workflowRunShowMock.mockResolvedValue(
      runDetail({ attempts: [attempt({ state: 'completed' })] })
    )

    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))
    await screen.findByText('Implement')

    expect(screen.queryByRole('button', { name: 'Rerun from this node' })).not.toBeInTheDocument()
  })

  it('reruns from a failed node and opens the resulting run', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary({ state: 'failed' })] })
    workflowRunShowMock.mockResolvedValue(runDetail())
    workflowRunRerunMock.mockResolvedValue({ runId: 'run-2' })
    const onOpenRun = vi.fn()

    renderHistory(onOpenRun)
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))
    const rerunButton = await screen.findByRole('button', { name: 'Rerun from this node' })
    fireEvent.click(rerunButton)

    await waitFor(() =>
      expect(workflowRunRerunMock).toHaveBeenCalledWith(settings, {
        runId: 'run-1',
        fromNodeId: 'implement'
      })
    )
    await waitFor(() => expect(onOpenRun).toHaveBeenCalledWith('run-2'))
  })

  it('shows a friendly message when a host lacks workflow.run.rerun', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary({ state: 'failed' })] })
    workflowRunShowMock.mockResolvedValue(runDetail())
    workflowRunRerunMock.mockRejectedValue(new Error('method_not_found'))

    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rerun from this node' }))

    await waitFor(() =>
      expect(screen.getByText(/isn.t available on this host yet/i)).toBeInTheDocument()
    )
  })

  it('maps workflow_rerun_refused to translated copy, not the host’s raw id-bearing text', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary({ state: 'failed' })] })
    workflowRunShowMock.mockResolvedValue(runDetail())
    // Shaped like the real transport: `RuntimeRpcCallError` carries the machine code on `.code`
    // separately from the host's human-readable `.message` (which embeds the run id).
    workflowRunRerunMock.mockRejectedValue({
      message: 'Run 01HX9ZZZ has a worker that may still be running; stop it first.',
      code: 'workflow_rerun_refused'
    })

    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rerun from this node' }))

    await waitFor(() =>
      expect(screen.getByText("This run can't be rerun right now.")).toBeInTheDocument()
    )
    expect(screen.queryByText(/01HX9ZZZ/)).not.toBeInTheDocument()
  })

  it('maps workflow_rerun_workspace_unavailable to translated copy, not the host’s raw text', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary({ state: 'failed' })] })
    workflowRunShowMock.mockResolvedValue(runDetail())
    workflowRunRerunMock.mockRejectedValue({
      message: "Run 01HX9ZZZ's workspace is not available: worktree missing",
      code: 'workflow_rerun_workspace_unavailable'
    })

    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rerun from this node' }))

    await waitFor(() =>
      expect(
        screen.getByText("This run's workspace isn't available right now.")
      ).toBeInTheDocument()
    )
    expect(screen.queryByText(/worktree missing/)).not.toBeInTheDocument()
  })

  it('falls back to the host’s raw message for a code this renderer does not map', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary({ state: 'failed' })] })
    workflowRunShowMock.mockResolvedValue(runDetail())
    workflowRunRerunMock.mockRejectedValue(
      new Error("Run run-1's workspace is not available: worktree missing")
    )

    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rerun from this node' }))

    await waitFor(() => expect(screen.getByText(/workspace is not available/)).toBeInTheDocument())
  })

  it('shows the rerun error next to the row that failed, not just anywhere in the list', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary({ state: 'failed' })] })
    workflowRunShowMock.mockResolvedValue(runDetail())
    workflowRunRerunMock.mockRejectedValue(new Error('workflow_rerun_refused'))

    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rerun from this node' }))

    const message = await screen.findByText("This run can't be rerun right now.")
    const nodeRow = message.closest('li')
    if (!nodeRow) {
      throw new Error('expected the rerun error to sit inside the failing node’s row')
    }
    expect(within(nodeRow).getByText('Implement')).toBeInTheDocument()
  })

  it('surfaces a translated message for a host that lacks workflow.run.list', async () => {
    workflowRunListMock.mockRejectedValue(new Error('method_not_found'))

    renderHistory()

    await waitFor(() =>
      expect(screen.getByText(/isn.t available on this host yet/i)).toBeInTheDocument()
    )
  })

  it('retries the list fetch when Retry is clicked', async () => {
    workflowRunListMock.mockRejectedValueOnce(new Error('host unreachable'))
    workflowRunListMock.mockResolvedValueOnce({ runs: [runSummary()] })

    renderHistory()
    await waitFor(() => expect(screen.getByText('host unreachable')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument())
    expect(workflowRunListMock).toHaveBeenCalledTimes(2)
  })

  it('retries a failed run.show fetch on re-expand, and again via the row’s Retry action', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary({ state: 'failed' })] })
    workflowRunShowMock.mockRejectedValueOnce(new Error('offline'))
    workflowRunShowMock.mockRejectedValueOnce(new Error('offline again'))
    workflowRunShowMock.mockResolvedValueOnce(runDetail())

    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))
    await waitFor(() =>
      expect(screen.getByText("Couldn't load this run's details.")).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(workflowRunShowMock).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.getByText("Couldn't load this run's details.")).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('Implement')).toBeInTheDocument())
  })

  it('shows an accessible, expandable Details control', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary()] })

    renderHistory()

    const detailsButton = await screen.findByRole('button', { name: 'Details' })
    expect(detailsButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(detailsButton)
    expect(detailsButton).toHaveAttribute('aria-expanded', 'true')
  })

  it('hints that rerunning a Loop body node restarts the whole loop', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary({ state: 'failed' })] })
    workflowRunShowMock.mockResolvedValue(
      runDetail({ workflowSnapshot: workflowWithLoop(), attempts: [attempt()] })
    )

    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))

    await waitFor(() => expect(screen.getByText('Restarts the whole loop')).toBeInTheDocument())
  })

  it('never labels a cancelled or join_skipped node as a failure, and offers no rerun for it', async () => {
    workflowRunListMock.mockResolvedValue({ runs: [runSummary({ state: 'failed' })] })
    workflowRunShowMock.mockResolvedValue(
      runDetail({
        attempts: [attempt({ state: 'cancelled', failureReason: 'join_skipped' })]
      })
    )

    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))

    const nodeTitle = await screen.findByText('Implement')
    const nodeRow = nodeTitle.closest('li')
    if (!nodeRow) {
      throw new Error('expected the node title to sit inside a row')
    }
    expect(within(nodeRow).getByText('Cancelled')).toBeInTheDocument()
    expect(within(nodeRow).queryByText('Failed')).not.toBeInTheDocument()
    expect(
      within(nodeRow).queryByRole('button', { name: 'Rerun from this node' })
    ).not.toBeInTheDocument()
  })

  it('offers Load more when the filtered first page is empty but a later page has this source’s runs', async () => {
    workflowRunListMock.mockResolvedValueOnce({
      runs: [runSummary({ id: 'run-personal', workflowSource: 'personal' })],
      nextCursor: 'cursor-1'
    })

    renderHistory()

    await waitFor(() => expect(screen.getByText(/no runs yet/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
  })

  it('loads more runs using the previous page’s cursor', async () => {
    workflowRunListMock.mockResolvedValueOnce({
      runs: [runSummary()],
      nextCursor: 'cursor-1'
    })
    workflowRunListMock.mockResolvedValueOnce({
      runs: [runSummary({ id: 'run-2' })]
    })

    renderHistory()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(workflowRunListMock).toHaveBeenLastCalledWith(settings, {
        repo: 'repo-1',
        name: 'wf',
        cursor: 'cursor-1'
      })
    )
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('drops rows from a different-sourced workflow of the same name', async () => {
    workflowRunListMock.mockResolvedValue({
      runs: [runSummary({ id: 'run-personal', workflowSource: 'personal' }), runSummary()]
    })

    renderHistory()

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(1))
  })
})

describe('RunHistory row scoping', () => {
  it('scopes each row’s Open button when several runs are listed', async () => {
    workflowRunListMock.mockResolvedValue({
      runs: [runSummary({ id: 'run-1' }), runSummary({ id: 'run-2' })]
    })
    const onOpenRun = vi.fn()

    renderHistory(onOpenRun)

    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Open' }))
    expect(onOpenRun).toHaveBeenCalledWith('run-2')
  })
})
