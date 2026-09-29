// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import WorkflowNodeProblemIndicator from './WorkflowNodeProblemIndicator'

afterEach(() => {
  cleanup()
})

describe('WorkflowNodeProblemIndicator', () => {
  it('renders nothing for a node without problems', () => {
    const { container } = render(<WorkflowNodeProblemIndicator problem={undefined} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the problem count inline and lists the messages on hover', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <WorkflowNodeProblemIndicator
          problem={{ severity: 'error', messages: ['Title is required.', 'Not reachable.'] }}
        />
      </TooltipProvider>
    )

    const indicator = screen.getByTestId('workflow-node-problem-indicator')
    expect(indicator).toHaveAttribute('data-severity', 'error')
    expect(indicator).toHaveTextContent('2')
    expect(indicator).toHaveAccessibleName('Problems: 2')

    await user.hover(indicator)
    expect((await screen.findAllByText('Title is required.')).length).toBeGreaterThan(0)
  })
})
