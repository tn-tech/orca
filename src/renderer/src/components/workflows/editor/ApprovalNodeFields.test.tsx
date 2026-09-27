// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalNode } from '../../../../../shared/workflows/workflow-definition-types'
import ApprovalNodeFields from './ApprovalNodeFields'

afterEach(() => {
  cleanup()
})

function approvalNode(patch: Partial<ApprovalNode> = {}): ApprovalNode {
  return {
    id: 'approval',
    type: 'approval',
    title: 'Approve the plan',
    question: 'Approve the plan?',
    options: ['Approve', 'Reject'],
    timeoutMs: 3_600_000,
    escalationGraceMs: 1_800_000,
    ...patch
  }
}

/** A real parent (NodeInspector, via the reducer) always echoes a committed edit back as the
 *  next `node` prop; this harness does the same so the duration-draft tests exercise the actual
 *  controlled contract, not a `node` prop frozen at its initial value (mirrors
 *  JoinNodeFields.test.tsx's `ControlledJoinNodeFields`). */
function ControlledApprovalNodeFields({
  initial,
  onChange
}: {
  initial: ApprovalNode
  onChange: (node: ApprovalNode) => void
}) {
  const [node, setNode] = useState(initial)
  return (
    <ApprovalNodeFields
      node={node}
      onChange={(next) => {
        setNode(next)
        onChange(next)
      }}
    />
  )
}

describe('ApprovalNodeFields (FR-033)', () => {
  it('renders the question and every configured option', () => {
    render(<ApprovalNodeFields node={approvalNode()} onChange={vi.fn()} />)

    expect(screen.getByLabelText('Question')).toHaveValue('Approve the plan?')
    expect(screen.getByDisplayValue('Approve')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Reject')).toBeInTheDocument()
  })

  it('edits the question', () => {
    const onChange = vi.fn()
    render(<ApprovalNodeFields node={approvalNode()} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Ship it?' } })

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ question: 'Ship it?' }))
  })

  it('adds a new empty option', () => {
    const onChange = vi.fn()
    render(<ApprovalNodeFields node={approvalNode()} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add option' }))

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: ['Approve', 'Reject', ''] })
    )
  })

  it('edits an option label', () => {
    const onChange = vi.fn()
    render(<ApprovalNodeFields node={approvalNode()} onChange={onChange} />)

    fireEvent.change(screen.getByDisplayValue('Reject'), { target: { value: 'Decline' } })

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: ['Approve', 'Decline'] })
    )
  })

  it('carries the default answer along when the renamed option was the default (review round 1, finding 4)', () => {
    const onChange = vi.fn()
    render(
      <ApprovalNodeFields node={approvalNode({ defaultOption: 'Reject' })} onChange={onChange} />
    )

    fireEvent.change(screen.getByDisplayValue('Reject'), { target: { value: 'Decline' } })

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: ['Approve', 'Decline'], defaultOption: 'Decline' })
    )
  })

  it('leaves an unrelated default answer alone when a different option is renamed', () => {
    const onChange = vi.fn()
    render(
      <ApprovalNodeFields node={approvalNode({ defaultOption: 'Approve' })} onChange={onChange} />
    )

    fireEvent.change(screen.getByDisplayValue('Reject'), { target: { value: 'Decline' } })

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ defaultOption: 'Approve' }))
  })

  it('removes an option, clearing the default answer if it was the one removed', () => {
    const onChange = vi.fn()
    render(
      <ApprovalNodeFields node={approvalNode({ defaultOption: 'Reject' })} onChange={onChange} />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove option' })[1])

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: ['Approve'], defaultOption: undefined })
    )
  })

  it('disables removing the last remaining option', () => {
    render(<ApprovalNodeFields node={approvalNode({ options: ['Approve'] })} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Remove option' })).toBeDisabled()
  })

  it('flags duplicate options with an inline error and aria-invalid on both rows', () => {
    render(
      <ApprovalNodeFields
        node={approvalNode({ options: ['Approve', 'Approve'] })}
        onChange={vi.fn()}
      />
    )

    expect(
      screen.getByText(
        'Options must be non-empty, unique, and not named exit or body — those are reserved for Loop ports.'
      )
    ).toBeInTheDocument()
    for (const input of screen.getAllByDisplayValue('Approve')) {
      expect(input).toHaveAttribute('aria-invalid', 'true')
    }
  })

  it('flags an option named exit or body as reserved for Loop ports', () => {
    render(
      <ApprovalNodeFields node={approvalNode({ options: ['exit', 'Reject'] })} onChange={vi.fn()} />
    )

    expect(screen.getByDisplayValue('exit')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByDisplayValue('Reject')).toHaveAttribute('aria-invalid', 'false')
    expect(
      screen.getByText(
        'Options must be non-empty, unique, and not named exit or body — those are reserved for Loop ports.'
      )
    ).toBeInTheDocument()
  })

  it('explains that an option with no outgoing edge stops the run', () => {
    render(<ApprovalNodeFields node={approvalNode()} onChange={vi.fn()} />)

    expect(
      screen.getByText(
        'Each option gets its own outgoing edge on the canvas; choosing an option with no edge stops the run.'
      )
    ).toBeInTheDocument()
  })

  it('offers only routable options as the default answer', () => {
    render(
      <ApprovalNodeFields
        node={approvalNode({ options: ['Approve', 'Approve', ''] })}
        onChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Default answer' }))
    expect(screen.getAllByRole('option')).toHaveLength(2) // "No default" plus the one routable option
    expect(screen.getByRole('option', { name: 'Approve' })).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'No default (the node fails on timeout)' })
    ).toBeInTheDocument()
  })

  it('sets the default answer', () => {
    const onChange = vi.fn()
    render(<ApprovalNodeFields node={approvalNode()} onChange={onChange} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Default answer' }))
    fireEvent.click(screen.getByRole('option', { name: 'Approve' }))

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ defaultOption: 'Approve' }))
  })

  it('shows the timeout and escalation grace in minutes', () => {
    render(
      <ApprovalNodeFields
        node={approvalNode({ timeoutMs: 600_000, escalationGraceMs: 120_000 })}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Timeout (minutes)')).toHaveValue(10)
    expect(screen.getByLabelText('Escalation grace (minutes)')).toHaveValue(2)
  })

  it('commits a retyped timeout in minutes as milliseconds', () => {
    const onChange = vi.fn()
    render(
      <ControlledApprovalNodeFields
        initial={approvalNode({ timeoutMs: 600_000 })}
        onChange={onChange}
      />
    )

    const input = screen.getByLabelText('Timeout (minutes)')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: '15' } })

    expect(input).toHaveValue(15)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeoutMs: 900_000 }))
  })

  it('keeps a blank timeout field blank instead of coercing it, and does not commit', () => {
    const onChange = vi.fn()
    render(<ApprovalNodeFields node={approvalNode({ timeoutMs: 600_000 })} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Timeout (minutes)'), { target: { value: '' } })

    expect(screen.getByLabelText('Timeout (minutes)')).toHaveValue(null)
    expect(screen.getByLabelText('Timeout (minutes)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a whole number of minutes, 1 or more.')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('resets the duration drafts when the node prop changes externally', () => {
    const { rerender } = render(
      <ApprovalNodeFields node={approvalNode({ timeoutMs: 600_000 })} onChange={vi.fn()} />
    )
    fireEvent.change(screen.getByLabelText('Timeout (minutes)'), { target: { value: '' } })
    expect(screen.getByLabelText('Timeout (minutes)')).toHaveValue(null)

    rerender(
      <ApprovalNodeFields
        node={approvalNode({ id: 'approval-2', timeoutMs: 1_200_000 })}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Timeout (minutes)')).toHaveValue(20)
  })
})
