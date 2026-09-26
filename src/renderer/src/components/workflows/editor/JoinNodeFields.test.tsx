// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
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

  it('sets the onFailure policy', () => {
    const onChange = vi.fn()
    render(<JoinNodeFields node={joinNode()} incomingEdgeCount={3} onChange={onChange} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'When a branch fails' }))
    fireEvent.click(screen.getByText('Continue with partial results'))

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ onFailure: 'partial' }))
  })
})
