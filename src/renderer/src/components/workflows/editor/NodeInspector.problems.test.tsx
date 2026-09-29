// @vitest-environment happy-dom
// F7: the inspector shows the selected element's own validation problems inline, so a freshly
// added node explains what it still needs right where the user edits it.
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../../shared/workflows/workflow-definition-types'
import NodeInspector, { type NodeInspectorProps } from './NodeInspector'

afterEach(() => {
  cleanup()
})

function workflow(title = 'Finish'): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'end-1', type: 'end', title }
    ],
    edges: [{ id: 'edge-1', from: 'start', to: 'end-1' }],
    layout: {}
  }
}

const problems: WorkflowProblem[] = [
  {
    code: 'graph_unreachable_node',
    message: 'Node "end-1" is not reachable from Start.',
    nodeId: 'end-1',
    severity: 'error'
  },
  { code: 'graph_x', message: 'Start-only problem.', nodeId: 'start', severity: 'warning' },
  { code: 'graph_cycle', message: 'Edge-only problem.', edgeId: 'edge-1', severity: 'error' }
]

function renderInspector(props: Partial<NodeInspectorProps>): void {
  render(
    <TooltipProvider>
      <NodeInspector
        definition={workflow()}
        problems={problems}
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
        {...props}
      />
    </TooltipProvider>
  )
}

describe('NodeInspector problems (F7)', () => {
  it("lists only the selected node's problems, named by title", () => {
    renderInspector({ selectedNodeId: 'end-1' })

    const list = screen.getByTestId('node-inspector-problems')
    expect(list).toHaveTextContent('Node "Finish" is not reachable from Start.')
    expect(list).not.toHaveTextContent('Start-only problem.')
    expect(list).not.toHaveTextContent('Edge-only problem.')
  })

  it("lists the selected edge's problems", () => {
    renderInspector({ selectedEdgeId: 'edge-1' })

    expect(screen.getByTestId('node-inspector-problems')).toHaveTextContent('Edge-only problem.')
  })

  it('shows no problem list for a clean node', () => {
    renderInspector({ selectedNodeId: 'end-1', problems: [] })

    expect(screen.queryByTestId('node-inspector-problems')).not.toBeInTheDocument()
  })

  it('marks an empty title field invalid', () => {
    renderInspector({ definition: workflow(''), selectedNodeId: 'end-1' })

    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
  })
})
