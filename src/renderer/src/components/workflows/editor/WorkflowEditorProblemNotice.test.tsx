// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkflowEditorProblemNotice from './WorkflowEditorProblemNotice'

afterEach(() => {
  cleanup()
})

describe('WorkflowEditorProblemNotice', () => {
  it('renders nothing without a problem', () => {
    const { container } = render(
      <WorkflowEditorProblemNotice problem={undefined} onWrapInLoop={vi.fn()} onDismiss={vi.fn()} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the refusal message and a "Wrap in Loop" action that reports the two node ids', () => {
    const onWrapInLoop = vi.fn()
    render(
      <WorkflowEditorProblemNotice
        problem={{
          code: 'graph_cycle',
          message: 'This connection would create a cycle outside a Loop node.',
          wrapNodeIds: ['b', 'a']
        }}
        onWrapInLoop={onWrapInLoop}
        onDismiss={vi.fn()}
      />
    )

    expect(
      screen.getByText('This connection would create a cycle outside a Loop node.')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Wrap in Loop' }))
    expect(onWrapInLoop).toHaveBeenCalledWith(['b', 'a'])
  })

  it('omits the "Wrap in Loop" action for a refusal with no suggested nodes', () => {
    render(
      <WorkflowEditorProblemNotice
        problem={{ code: 'workflow_editor_node_not_found', message: 'Node "x" was not found.' }}
        onWrapInLoop={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'Wrap in Loop' })).not.toBeInTheDocument()
  })

  it('dismisses on click', () => {
    const onDismiss = vi.fn()
    render(
      <WorkflowEditorProblemNotice
        problem={{ code: 'graph_cycle', message: 'Refused.' }}
        onWrapInLoop={vi.fn()}
        onDismiss={onDismiss}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
