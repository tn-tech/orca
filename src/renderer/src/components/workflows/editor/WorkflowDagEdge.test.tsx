// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { Position } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkflowDagEdge from './WorkflowDagEdge'

afterEach(() => {
  cleanup()
})

/** Every `EdgeProps` field `WorkflowDagEdge` receives but `<path>` has no business rendering
 *  (F10 round 1 review, Important #1): `BaseEdge` forwards unknown props straight onto the DOM. */
function edgeProps() {
  return {
    id: 'e1',
    source: 'a',
    target: 'b',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    sourceHandleId: null,
    targetHandleId: null,
    selected: false,
    animated: false,
    selectable: true,
    deletable: true,
    data: { laneY: 40 },
    type: 'dag' as const,
    style: { stroke: 'red' },
    markerEnd: undefined,
    pathOptions: { curvature: 1 }
  }
}

describe('WorkflowDagEdge', () => {
  it('renders only real SVG path attributes, not the raw EdgeProps fields (F10 round 1)', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { container } = render(
      <svg>
        <WorkflowDagEdge {...edgeProps()} />
      </svg>
    )

    const path = container.querySelector('path.react-flow__edge-path')
    expect(path).not.toBeNull()
    for (const leaked of [
      'sourcex',
      'sourcey',
      'targetx',
      'targety',
      'sourceposition',
      'targetposition',
      'sourcehandleid',
      'targethandleid',
      'selected',
      'animated',
      'selectable',
      'deletable',
      'data',
      'source',
      'target',
      'type',
      'pathoptions'
    ]) {
      expect(path?.hasAttribute(leaked)).toBe(false)
    }
    expect(consoleError).not.toHaveBeenCalled()
  })
})
