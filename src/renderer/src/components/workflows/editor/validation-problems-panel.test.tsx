// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowProblem } from '../../../../../shared/workflows/workflow-definition-types'
import ValidationProblemsPanel from './ValidationProblemsPanel'

afterEach(() => {
  cleanup()
})

function problem(patch: Partial<WorkflowProblem> = {}): WorkflowProblem {
  return {
    code: 'graph_cycle',
    message: 'This connection would create a cycle.',
    severity: 'error',
    ...patch
  }
}

describe('ValidationProblemsPanel', () => {
  it('shows an empty state when there are no problems', () => {
    render(<ValidationProblemsPanel problems={[]} onFocusProblem={vi.fn()} />)

    expect(screen.getByTestId('validation-problems-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('validation-problems-panel')).not.toBeInTheDocument()
  })

  it('lists every problem with its message and location, errors before warnings', () => {
    const problems = [
      problem({ code: 'graph_missing_end', message: 'Missing an End node.', severity: 'warning' }),
      problem({
        code: 'graph_unknown_role',
        message: 'Unknown role.',
        nodeId: 'work',
        roleId: 'dev'
      })
    ]

    render(<ValidationProblemsPanel problems={problems} onFocusProblem={vi.fn()} />)

    const rows = screen.getAllByTestId('validation-problem-row')
    expect(rows).toHaveLength(2)
    // Error-severity row (the role problem) sorts first, ahead of the warning.
    expect(rows[0]).toHaveAttribute('data-severity', 'error')
    expect(rows[0]).toHaveTextContent('Unknown role.')
    expect(rows[0]).toHaveTextContent('Node "work"')
    expect(rows[1]).toHaveAttribute('data-severity', 'warning')
    expect(rows[1]).toHaveTextContent('Missing an End node.')
  })

  it('summarizes error and warning counts', () => {
    render(
      <ValidationProblemsPanel
        problems={[problem(), problem({ severity: 'warning' })]}
        onFocusProblem={vi.fn()}
      />
    )

    expect(screen.getByText('1 error(s), 1 warning(s)')).toBeInTheDocument()
  })

  it('calls onFocusProblem with the clicked problem', () => {
    const onFocusProblem = vi.fn()
    const target = problem({ code: 'graph_cycle', nodeId: 'a', edgeId: 'edge-1' })

    render(<ValidationProblemsPanel problems={[target]} onFocusProblem={onFocusProblem} />)
    fireEvent.click(screen.getByTestId('validation-problem-row'))

    expect(onFocusProblem).toHaveBeenCalledExactlyOnceWith(target)
  })
})
