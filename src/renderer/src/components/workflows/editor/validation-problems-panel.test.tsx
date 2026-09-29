// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../../shared/workflows/workflow-definition-types'
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

  it('names nodes by title rather than id when given the definition (N7)', () => {
    const definition: Workflow = {
      version: 1,
      name: 'wf',
      workspacePolicy: 'run-workspace',
      roles: {},
      nodes: [{ id: 'agent-3f2a', type: 'start', title: 'Kickoff' }],
      edges: [],
      layout: {}
    }

    render(
      <ValidationProblemsPanel
        problems={[problem({ message: 'Node "agent-3f2a" is unreachable.', nodeId: 'agent-3f2a' })]}
        definition={definition}
        onFocusProblem={vi.fn()}
      />
    )

    const row = screen.getByTestId('validation-problem-row')
    expect(row).toHaveTextContent('Node "Kickoff" is unreachable.')
    expect(row).toHaveTextContent('Node "Kickoff"')
    expect(row).not.toHaveTextContent('agent-3f2a')
  })

  it('collapses to its summary line and expands again', () => {
    render(<ValidationProblemsPanel problems={[problem()]} onFocusProblem={vi.fn()} />)

    const toggle = screen.getByRole('button', { name: /1 error\(s\), 0 warning\(s\)/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('validation-problem-row')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByTestId('validation-problem-row')).toBeInTheDocument()
  })
})
