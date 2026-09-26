// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
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

/** A real parent (NodeInspector, via the reducer) always echoes a committed edit back as the
 *  next `condition` prop; this harness does the same so interaction tests exercise the actual
 *  controlled contract, not a `condition` prop frozen at its initial value. */
function ControlledConditionBuilder({
  initial,
  onChange
}: {
  initial: Condition | undefined
  onChange: (condition: Condition | undefined) => void
}) {
  const [condition, setCondition] = useState(initial)
  return (
    <ConditionBuilder
      condition={condition}
      onChange={(next) => {
        setCondition(next)
        onChange(next)
      }}
    />
  )
}

describe('ConditionBuilder', () => {
  it('shows the unconditioned copy when the edge has no condition', () => {
    render(<ConditionBuilder condition={undefined} onChange={vi.fn()} />)
    expect(screen.getByText('No condition — this edge always fires.')).toBeInTheDocument()
  })

  it('builds a leaf condition through the UI and reports it via onChange', () => {
    const onChange = conditionChangeSpy()
    render(<ControlledConditionBuilder initial={undefined} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }))
    fireEvent.change(screen.getByPlaceholderText('result path (e.g. approved)'), {
      target: { value: 'approved' }
    })

    fireEvent.click(screen.getByRole('combobox', { name: 'Comparison' }))
    fireEvent.click(screen.getByText('equals'))

    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'true' } })

    const last = onChange.mock.calls.at(-1)?.[0]
    expect(last).toEqual({ path: 'approved', op: 'eq', value: true })
    // The controlled round-trip didn't reset the row mid-edit.
    expect(screen.getByPlaceholderText('result path (e.g. approved)')).toHaveValue('approved')
  })

  it('round-trips an existing `all` condition into rows the user can keep editing', () => {
    const initial: Condition = {
      all: [
        { path: 'approved', op: 'truthy' },
        { path: 'findings', op: 'lengthGt', value: 0 }
      ]
    }
    const onChange = conditionChangeSpy()
    render(<ControlledConditionBuilder initial={initial} onChange={onChange} />)

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
    // The controlled round-trip kept the checkbox checked instead of snapping back.
    expect(screen.getByLabelText('Negate (NOT)')).toBeChecked()
  })

  it('removing every row reports an unconditioned edge', () => {
    const onChange = conditionChangeSpy()
    render(
      <ControlledConditionBuilder
        initial={{ path: 'approved', op: 'truthy' }}
        onChange={onChange}
      />
    )

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

  it('resyncs its rows when the edge condition changes externally while it stays selected', () => {
    // Simulates undo/redo or another client editing the same edge: the `condition` prop changes
    // without ConditionBuilder's own `onChange` having produced it.
    const onChange = vi.fn()
    const { rerender } = render(
      <ConditionBuilder condition={{ path: 'approved', op: 'truthy' }} onChange={onChange} />
    )
    expect(screen.getByLabelText('Result path')).toHaveValue('approved')

    rerender(
      <ConditionBuilder
        condition={{ path: 'findings', op: 'lengthGt', value: 3 }}
        onChange={onChange}
      />
    )

    expect(screen.getByLabelText('Result path')).toHaveValue('findings')
    expect(screen.getByPlaceholderText('value')).toHaveValue('3')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps a freshly-added empty draft row instead of resetting it', () => {
    // An empty-path row encodes to `undefined` (data-model.md: empty path is dropped), so the
    // `condition` prop legitimately stays unchanged right after adding it — this must not be
    // mistaken for an external change that wipes the draft row back out.
    const onChange = vi.fn()
    render(<ConditionBuilder condition={undefined} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }))

    expect(screen.getByPlaceholderText('result path (e.g. approved)')).toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})
