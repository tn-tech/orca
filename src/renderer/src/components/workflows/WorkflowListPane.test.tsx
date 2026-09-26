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
  onDelete: vi.fn().mockResolvedValue(undefined)
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
})
