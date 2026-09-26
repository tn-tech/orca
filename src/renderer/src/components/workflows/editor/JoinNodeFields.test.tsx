// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JoinNode } from '../../../../../shared/workflows/workflow-definition-types'
import JoinNodeFields from './JoinNodeFields'

afterEach(() => {
  cleanup()
})

function joinNode(patch: Partial<JoinNode> = {}): JoinNode {
  return {
    id: 'join',
    type: 'join',
    title: 'Join',
    policy: 'all',
    onFailure: 'fail',
    ...patch
  }
}

/** A real parent (NodeInspector, via the reducer) always echoes a committed edit back as the
 *  next `node` prop; this harness does the same so the quorum-draft tests exercise the actual
 *  controlled contract, not a `node` prop frozen at its initial value. */
function ControlledJoinNodeFields({
  initial,
  incomingEdgeCount,
  onChange
}: {
  initial: JoinNode
  incomingEdgeCount: number
  onChange: (node: JoinNode) => void
}) {
  const [node, setNode] = useState(initial)
  return (
    <JoinNodeFields
      node={node}
      incomingEdgeCount={incomingEdgeCount}
      onChange={(next) => {
        setNode(next)
        onChange(next)
      }}
    />
  )
}

describe('JoinNodeFields (FR-007)', () => {
  it('shows the wait-all policy and fail failure policy by default', () => {
    render(<JoinNodeFields node={joinNode()} incomingEdgeCount={3} onChange={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Policy' })).toHaveTextContent(
      'Wait for all branches'
    )
    expect(screen.getByRole('combobox', { name: 'When a branch fails' })).toHaveTextContent(
      'Fail the join'
    )
    expect(screen.queryByLabelText('Quorum')).not.toBeInTheDocument()
  })

  it('switches to quorum and shows a quorum input defaulting to 1', () => {
    const onChange = vi.fn()
    render(<JoinNodeFields node={joinNode()} incomingEdgeCount={3} onChange={onChange} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Policy' }))
    fireEvent.click(screen.getByText('Continue after a quorum'))

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ policy: { quorum: 1 } }))
  })

  it('flags a quorum higher than the number of incoming branches', () => {
    render(
      <JoinNodeFields
        node={joinNode({ policy: { quorum: 5 } })}
        incomingEdgeCount={3}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Quorum')).toHaveValue(5)
    expect(screen.getByLabelText('Quorum')).toHaveAttribute('aria-invalid', 'true')
    expect(
      screen.getByText('Quorum is higher than the number of incoming branches.')
    ).toBeInTheDocument()
  })

  it('does not flag a quorum within the number of incoming branches', () => {
    render(
      <JoinNodeFields
        node={joinNode({ policy: { quorum: 2 } })}
        incomingEdgeCount={3}
        onChange={vi.fn()}
      />
    )

    expect(
      screen.queryByText('Quorum is higher than the number of incoming branches.')
    ).not.toBeInTheDocument()
  })

  it('keeps a blank quorum field blank instead of coercing it back to 1 (review round 1)', () => {
    const onChange = vi.fn()
    render(
      <ControlledJoinNodeFields
        initial={joinNode({ policy: { quorum: 5 } })}
        incomingEdgeCount={3}
        onChange={onChange}
      />
    )

    fireEvent.change(screen.getByLabelText('Quorum'), { target: { value: '' } })

    expect(screen.getByLabelText('Quorum')).toHaveValue(null)
    expect(screen.getByLabelText('Quorum')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a whole number of 1 or more.')).toBeInTheDocument()
    // No commit while the field is blank — the last valid quorum (5) is still in effect.
    expect(onChange).not.toHaveBeenCalled()
  })

  it('lets a cleared quorum field be retyped into a new multi-digit value', () => {
    const onChange = vi.fn()
    render(
      <ControlledJoinNodeFields
        initial={joinNode({ policy: { quorum: 5 } })}
        incomingEdgeCount={3}
        onChange={onChange}
      />
    )

    const input = screen.getByLabelText('Quorum')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.change(input, { target: { value: '12' } })

    expect(input).toHaveValue(12)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ policy: { quorum: 12 } }))
  })

  it('does not commit non-numeric quorum text, and flags it as invalid', () => {
    const onChange = vi.fn()
    render(
      <JoinNodeFields
        node={joinNode({ policy: { quorum: 5 } })}
        incomingEdgeCount={3}
        onChange={onChange}
      />
    )

    fireEvent.change(screen.getByLabelText('Quorum'), { target: { value: 'abc' } })

    expect(screen.getByLabelText('Quorum')).toHaveValue(null)
    expect(screen.getByLabelText('Quorum')).toHaveAttribute('aria-invalid', 'true')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('resets the quorum draft when the node prop changes externally', () => {
    const { rerender } = render(
      <JoinNodeFields
        node={joinNode({ policy: { quorum: 5 } })}
        incomingEdgeCount={3}
        onChange={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText('Quorum'), { target: { value: '' } })
    expect(screen.getByLabelText('Quorum')).toHaveValue(null)

    // A different node entirely (e.g. selecting another Join) is an external change.
    rerender(
      <JoinNodeFields
        node={joinNode({ id: 'join-2', policy: { quorum: 7 } })}
        incomingEdgeCount={3}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Quorum')).toHaveValue(7)
  })

  it('sets the onFailure policy', () => {
    const onChange = vi.fn()
    render(<JoinNodeFields node={joinNode()} incomingEdgeCount={3} onChange={onChange} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'When a branch fails' }))
    fireEvent.click(screen.getByText('Continue with partial results'))

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ onFailure: 'partial' }))
  })
})
