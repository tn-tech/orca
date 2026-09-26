// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Condition } from '../../../../../shared/workflows/workflow-definition-types'
import ConditionBuilder from './ConditionBuilder'

afterEach(() => {
  cleanup()
})

function conditionChangeSpy() {
  return vi.fn<(condition: Condition | undefined) => void>()
}

describe('ConditionBuilder', () => {
  it('shows the unconditioned copy when the edge has no condition', () => {
    render(<ConditionBuilder condition={undefined} onChange={vi.fn()} />)
    expect(screen.getByText('No condition — this edge always fires.')).toBeInTheDocument()
  })

  it('builds a leaf condition through the UI and reports it via onChange', () => {
    const onChange = conditionChangeSpy()
    render(<ConditionBuilder condition={undefined} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }))
    fireEvent.change(screen.getByPlaceholderText('result path (e.g. approved)'), {
      target: { value: 'approved' }
    })

    fireEvent.click(screen.getByRole('combobox', { name: 'Comparison' }))
    fireEvent.click(screen.getByText('equals'))

    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'true' } })

    const last = onChange.mock.calls.at(-1)?.[0]
    expect(last).toEqual({ path: 'approved', op: 'eq', value: true })
  })

  it('round-trips an existing `all` condition into rows the user can keep editing', () => {
    const initial: Condition = {
      all: [
        { path: 'approved', op: 'truthy' },
        { path: 'findings', op: 'lengthGt', value: 0 }
      ]
    }
    const onChange = conditionChangeSpy()
    render(<ConditionBuilder condition={initial} onChange={onChange} />)

    const paths = screen.getAllByLabelText('Result path')
    expect(
      paths.map((input) => (input instanceof HTMLInputElement ? input.value : undefined))
    ).toEqual(['approved', 'findings'])
    // Truthy/falsy rows have no value input; the lengthGt row does.
    expect(screen.getAllByLabelText('Comparison value')).toHaveLength(1)
    expect(screen.getByText('Match all')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Negate (NOT)'))
    const last = onChange.mock.calls.at(-1)?.[0]
    expect(last).toEqual({ not: initial })
  })

  it('removing every row reports an unconditioned edge', () => {
    const onChange = vi.fn()
    render(<ConditionBuilder condition={{ path: 'approved', op: 'truthy' }} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove condition' }))

    expect(onChange).toHaveBeenLastCalledWith(undefined)
    expect(screen.getByText('No condition — this edge always fires.')).toBeInTheDocument()
  })

  it('flags an unsupported nested shape instead of silently discarding it', () => {
    const nested: Condition = {
      all: [{ any: [{ path: 'a', op: 'truthy' }] }, { path: 'b', op: 'truthy' }]
    }
    render(<ConditionBuilder condition={nested} onChange={vi.fn()} />)
    expect(screen.getByText(/condition can't be shown here/)).toBeInTheDocument()
  })
})
