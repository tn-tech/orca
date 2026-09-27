// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowSummary } from '@/runtime/runtime-workflow-client'
import WorkflowListPane from './WorkflowListPane'

afterEach(() => {
  cleanup()
})

function row(patch: Partial<WorkflowSummary> = {}): WorkflowSummary {
  return {
    name: 'ship-it',
    source: 'project',
    path: '/repo/orca-workflows/ship-it.workflow.yaml',
    valid: true,
    ...patch
  }
}

const noop = {
  onOpen: vi.fn(),
  onCreate: vi.fn().mockResolvedValue(undefined),
  onDuplicate: vi.fn().mockResolvedValue(undefined),
  onDelete: vi.fn().mockResolvedValue(undefined),
  draftUnsaved: false,
  onDraft: vi.fn(),
  onOpenDraft: vi.fn()
}

/** Radix's DropdownMenuTrigger opens on pointerdown, not click. */
function openRowMenu(): void {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Workflow actions' }), { button: 0 })
}

describe('WorkflowListPane', () => {
  it('shows the empty state when there are no rows', () => {
    render(<WorkflowListPane rows={[]} loading={false} error={null} selected={null} {...noop} />)

    expect(screen.getByText(/No workflows yet/)).toBeInTheDocument()
  })

  it('shows a fetch error', () => {
    render(<WorkflowListPane rows={[]} loading={false} error="boom" selected={null} {...noop} />)

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('renders a Personal badge only for personal-source rows', () => {
    render(
      <WorkflowListPane
        rows={[row({ name: 'proj-flow' }), row({ name: 'my-flow', source: 'personal' })]}
        loading={false}
        error={null}
        selected={null}
        {...noop}
      />
    )

    expect(screen.getByText('proj-flow')).toBeInTheDocument()
    expect(screen.getByText('my-flow')).toBeInTheDocument()
    expect(screen.getAllByText('Personal')).toHaveLength(1)
  })

  it('calls onOpen when a row is clicked', () => {
    const onOpen = vi.fn()
    const target = row()
    render(
      <WorkflowListPane
        rows={[target]}
        loading={false}
        error={null}
        selected={null}
        {...noop}
        onOpen={onOpen}
      />
    )

    fireEvent.click(screen.getByText('ship-it'))

    expect(onOpen).toHaveBeenCalledExactlyOnceWith(target)
  })

  it('creates a workflow through the New dialog', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <WorkflowListPane
        rows={[]}
        loading={false}
        error={null}
        selected={null}
        {...noop}
        onCreate={onCreate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'New workflow' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'new-flow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledExactlyOnceWith('new-flow', 'project'))
  })

  it('reopens the New dialog blank after it was closed with typed text', () => {
    render(<WorkflowListPane rows={[]} loading={false} error={null} selected={null} {...noop} />)

    fireEvent.click(screen.getByRole('button', { name: 'New workflow' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'typed-name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New workflow' }))

    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('opens the Duplicate dialog pre-filled with "<name>-copy" for the clicked row', async () => {
    render(
      <WorkflowListPane
        rows={[row({ name: 'ship-it' })]}
        loading={false}
        error={null}
        selected={null}
        {...noop}
      />
    )

    openRowMenu()
    fireEvent.click(await screen.findByText('Duplicate'))

    expect(await screen.findByLabelText('Name')).toHaveValue('ship-it-copy')
  })

  it('reopens the Duplicate dialog with a fresh "<name>-copy" after being closed', async () => {
    render(
      <WorkflowListPane
        rows={[row({ name: 'ship-it' })]}
        loading={false}
        error={null}
        selected={null}
        {...noop}
      />
    )

    openRowMenu()
    fireEvent.click(await screen.findByText('Duplicate'))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'edited' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()

    openRowMenu()
    fireEvent.click(await screen.findByText('Duplicate'))

    expect(await screen.findByLabelText('Name')).toHaveValue('ship-it-copy')
  })

  it('refuses an empty name without calling onCreate', async () => {
    const onCreate = vi.fn()
    render(
      <WorkflowListPane
        rows={[]}
        loading={false}
        error={null}
        selected={null}
        {...noop}
        onCreate={onCreate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'New workflow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Enter a name.')).toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('opens the Draft-from-objective dialog', () => {
    render(<WorkflowListPane rows={[]} loading={false} error={null} selected={null} {...noop} />)

    fireEvent.click(screen.getByRole('button', { name: 'Draft from objective' }))

    expect(screen.getByLabelText('Objective')).toBeInTheDocument()
  })

  describe('unsaved-draft discard confirmation', () => {
    it('asks to discard before opening a different workflow, and proceeds once confirmed', async () => {
      const onOpen = vi.fn()
      const target = row()
      render(
        <WorkflowListPane
          rows={[target]}
          loading={false}
          error={null}
          selected={null}
          {...noop}
          draftUnsaved
          onOpen={onOpen}
        />
      )

      fireEvent.click(screen.getByText('ship-it'))

      expect(onOpen).not.toHaveBeenCalled()
      expect(await screen.findByText('Discard unsaved draft?')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

      expect(onOpen).toHaveBeenCalledExactlyOnceWith(target)
    })

    it('leaves the draft open when the discard prompt is cancelled', async () => {
      const onOpen = vi.fn()
      render(
        <WorkflowListPane
          rows={[row()]}
          loading={false}
          error={null}
          selected={null}
          {...noop}
          draftUnsaved
          onOpen={onOpen}
        />
      )

      fireEvent.click(screen.getByText('ship-it'))
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

      expect(onOpen).not.toHaveBeenCalled()
      expect(screen.queryByText('Discard unsaved draft?')).not.toBeInTheDocument()
    })

    it('asks to discard before opening the New workflow dialog', async () => {
      render(
        <WorkflowListPane
          rows={[]}
          loading={false}
          error={null}
          selected={null}
          {...noop}
          draftUnsaved
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'New workflow' }))

      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
      expect(await screen.findByText('Discard unsaved draft?')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

      expect(await screen.findByLabelText('Name')).toBeInTheDocument()
    })

    it('does not prompt when there is no unsaved draft', () => {
      const onOpen = vi.fn()
      const target = row()
      render(
        <WorkflowListPane
          rows={[target]}
          loading={false}
          error={null}
          selected={null}
          {...noop}
          onOpen={onOpen}
        />
      )

      fireEvent.click(screen.getByText('ship-it'))

      expect(onOpen).toHaveBeenCalledExactlyOnceWith(target)
      expect(screen.queryByText('Discard unsaved draft?')).not.toBeInTheDocument()
    })
  })
})
