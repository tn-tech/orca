// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'
import DraftWorkflowDialog from './DraftWorkflowDialog'

afterEach(() => {
  cleanup()
})

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function draftedWorkflow(patch: Partial<Workflow> = {}): Workflow {
  return {
    version: 1,
    name: 'triage-tickets',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [{ id: 'e1', from: 'start', to: 'end' }],
    layout: { start: { x: 0, y: 0 }, end: { x: 320, y: 0 } },
    ...patch
  }
}

class MethodNotFoundError extends Error {
  code = 'method_not_found'
  constructor() {
    super('method_not_found')
  }
}

describe('DraftWorkflowDialog (US6)', () => {
  it('drafts and opens the editor immediately when there are no problems', async () => {
    const definition = draftedWorkflow()
    const onDraft = vi
      .fn()
      .mockResolvedValue({ definition, problems: [], draft: true, runId: 'run-1' })
    const onOpenDraft = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <DraftWorkflowDialog
        open
        onOpenChange={onOpenChange}
        onDraft={onDraft}
        onOpenDraft={onOpenDraft}
      />
    )

    fireEvent.change(screen.getByLabelText('Objective'), {
      target: { value: 'Triage new support tickets and draft a reply for review.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Draft workflow' }))

    await waitFor(() =>
      expect(onDraft).toHaveBeenCalledExactlyOnceWith(
        'Triage new support tickets and draft a reply for review.'
      )
    )
    await waitFor(() => expect(onOpenDraft).toHaveBeenCalledExactlyOnceWith(definition))
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('refuses to submit an empty objective', () => {
    const onDraft = vi.fn()
    render(
      <DraftWorkflowDialog open onOpenChange={vi.fn()} onDraft={onDraft} onOpenDraft={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'Draft workflow' })).toBeDisabled()
    expect(onDraft).not.toHaveBeenCalled()
  })

  it('shows returned problems and waits for "Open in editor" before loading the draft', async () => {
    const definition = draftedWorkflow()
    const onDraft = vi.fn().mockResolvedValue({
      definition,
      problems: [{ code: 'missing_role', message: 'Node "review" has no role', severity: 'error' }],
      draft: true,
      runId: 'run-1'
    })
    const onOpenDraft = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <DraftWorkflowDialog
        open
        onOpenChange={onOpenChange}
        onDraft={onDraft}
        onOpenDraft={onOpenDraft}
      />
    )

    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Triage tickets.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft workflow' }))

    expect(await screen.findByText('Node "review" has no role')).toBeInTheDocument()
    expect(onOpenDraft).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }))

    expect(onOpenDraft).toHaveBeenCalledExactlyOnceWith(definition)
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('shows the problems and offers no "Open in editor" when the planner produced no definition', async () => {
    const onDraft = vi.fn().mockResolvedValue({
      problems: [
        {
          code: 'workflow_draft_timeout',
          message:
            'The planner did not finish in time; its run keeps going and can be followed there.',
          severity: 'error'
        }
      ],
      draft: true,
      runId: 'run-1'
    })
    const onOpenDraft = vi.fn()
    render(
      <DraftWorkflowDialog
        open
        onOpenChange={vi.fn()}
        onDraft={onDraft}
        onOpenDraft={onOpenDraft}
      />
    )

    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Triage tickets.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft workflow' }))

    expect(
      await screen.findByText(
        'The planner did not finish in time; its run keeps going and can be followed there.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open in editor' })).not.toBeInTheDocument()
    expect(onOpenDraft).not.toHaveBeenCalled()
  })

  it('shows a note that the planner keeps running while it drafts', async () => {
    const deferred = createDeferred<{
      definition: Workflow
      problems: []
      draft: true
      runId: string
    }>()
    const onDraft = vi.fn().mockReturnValue(deferred.promise)
    render(
      <DraftWorkflowDialog open onOpenChange={vi.fn()} onDraft={onDraft} onOpenDraft={vi.fn()} />
    )

    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Triage tickets.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft workflow' }))

    expect(await screen.findByText(/can take several minutes/i)).toBeInTheDocument()

    deferred.resolve({ definition: draftedWorkflow(), problems: [], draft: true, runId: 'run-1' })
    await waitFor(() => expect(onDraft).toHaveBeenCalled())
  })

  it('ignores the result once the dialog is closed while the planner is still running', async () => {
    const deferred = createDeferred<{
      definition: Workflow
      problems: []
      draft: true
      runId: string
    }>()
    const onDraft = vi.fn().mockReturnValue(deferred.promise)
    const onOpenDraft = vi.fn()
    const { rerender } = render(
      <DraftWorkflowDialog
        open
        onOpenChange={vi.fn()}
        onDraft={onDraft}
        onOpenDraft={onOpenDraft}
      />
    )

    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Triage tickets.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft workflow' }))
    await waitFor(() => expect(onDraft).toHaveBeenCalled())

    rerender(
      <DraftWorkflowDialog
        open={false}
        onOpenChange={vi.fn()}
        onDraft={onDraft}
        onOpenDraft={onOpenDraft}
      />
    )
    deferred.resolve({ definition: draftedWorkflow(), problems: [], draft: true, runId: 'run-1' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onOpenDraft).not.toHaveBeenCalled()
  })

  it('shows a friendly message and stops accepting input when the host lacks workflow.draft', async () => {
    const onDraft = vi.fn().mockRejectedValue(new MethodNotFoundError())
    render(
      <DraftWorkflowDialog open onOpenChange={vi.fn()} onDraft={onDraft} onOpenDraft={vi.fn()} />
    )

    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Triage tickets.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft workflow' }))

    expect(
      await screen.findByText(
        "Drafting a workflow from an objective isn't supported by this host yet."
      )
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Objective')).toBeDisabled()
  })

  it('shows a generic error and lets the user retry on any other failure', async () => {
    const onDraft = vi.fn().mockRejectedValueOnce(new Error('planner unavailable'))
    render(
      <DraftWorkflowDialog open onOpenChange={vi.fn()} onDraft={onDraft} onOpenDraft={vi.fn()} />
    )

    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Triage tickets.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft workflow' }))

    expect(await screen.findByText('planner unavailable')).toBeInTheDocument()
    expect(screen.getByLabelText('Objective')).not.toBeDisabled()
  })
})
