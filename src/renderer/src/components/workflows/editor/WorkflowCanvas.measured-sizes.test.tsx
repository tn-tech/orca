// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { computeAutoLayout, measureWorkflowNodeSize } from './workflow-auto-layout'
import WorkflowCanvas, { type WorkflowCanvasHandle } from './WorkflowCanvas'

/** Same shape `virtualized-list.test.tsx` uses: a real `ResizeObserver` stand-in, fired manually,
 *  since happy-dom never measures layout on its own. */
type ResizeObserverBoxSize = { blockSize: number; inlineSize: number }
const activeResizeObservers = new Set<MockResizeObserver>()

class MockResizeObserver implements ResizeObserver {
  readonly elements = new Set<Element>()
  readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    activeResizeObservers.add(this)
  }
  observe(element: Element): void {
    this.elements.add(element)
  }
  unobserve(element: Element): void {
    this.elements.delete(element)
  }
  disconnect(): void {
    this.elements.clear()
    activeResizeObservers.delete(this)
  }
}

function fireResizeObservers(): void {
  for (const observer of activeResizeObservers) {
    const targets = Array.from(observer.elements)
    if (targets.length === 0) {
      continue
    }
    const entries = targets.map((element) => {
      const size: ResizeObserverBoxSize = {
        blockSize: element instanceof HTMLElement ? element.offsetHeight : 0,
        inlineSize: element instanceof HTMLElement ? element.offsetWidth : 0
      }
      return {
        target: element,
        contentRect: element.getBoundingClientRect(),
        borderBoxSize: [size],
        contentBoxSize: [size],
        devicePixelContentBoxSize: [size]
      } satisfies ResizeObserverEntry
    })
    observer.callback(entries, observer)
  }
}

/** The DOM size the real router-choices card would render at, given the router's real content
 *  (many choices) — deliberately taller than `measureWorkflowNodeSize`'s estimate so a test that
 *  used the estimate instead would tell the two apart. */
const ROUTER_RENDERED_HEIGHT = 900
const DEFAULT_RENDERED_WIDTH = 220
const DEFAULT_RENDERED_HEIGHT = 64

function manyChoiceRouterDefinition(): Workflow {
  return {
    version: 1,
    name: 'measured-sizes-test',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      {
        id: 'router',
        type: 'router',
        title: 'Router',
        prompt: 'choose',
        choices: Array.from({ length: 8 }, (_, i) => `Option ${i + 1}`)
      }
    ],
    edges: [{ id: 'e1', from: 'start', to: 'router' }],
    layout: { start: { x: 0, y: 0 }, router: { x: 300, y: 0 } }
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  activeResizeObservers.clear()
  host = document.createElement('div')
  // React Flow measures its own container; needs a non-zero box to initialize.
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800))
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      if (
        this.classList.contains('react-flow__renderer') ||
        this.classList.contains('react-flow')
      ) {
        return 1200
      }
      if (this.getAttribute('data-id') === 'router') {
        return DEFAULT_RENDERED_WIDTH
      }
      return this.classList.contains('react-flow__node') ? DEFAULT_RENDERED_WIDTH : 0
    }
  )
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      if (
        this.classList.contains('react-flow__renderer') ||
        this.classList.contains('react-flow')
      ) {
        return 800
      }
      if (this.getAttribute('data-id') === 'router') {
        return ROUTER_RENDERED_HEIGHT
      }
      return this.classList.contains('react-flow__node') ? DEFAULT_RENDERED_HEIGHT : 0
    }
  )
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WorkflowCanvas measured sizes (round 2: the real React Flow measurement path)', () => {
  it('getMeasuredSizes reads the real DOM size React Flow measured, not the estimate', async () => {
    const ref: { current: WorkflowCanvasHandle | null } = { current: null }
    const definition = manyChoiceRouterDefinition()

    await act(async () => {
      root.render(<WorkflowCanvas ref={ref} definition={definition} />)
    })
    await act(async () => {
      fireResizeObservers()
    })

    const sizes = ref.current?.getMeasuredSizes()
    const routerSize = sizes?.get('router')

    expect(routerSize).toBeDefined()
    expect(routerSize?.height).toBe(ROUTER_RENDERED_HEIGHT)
    // The estimate for an 8-choice Router is nowhere near the real rendered height — proving this
    // came from React Flow's own measurement, not `measureWorkflowNodeSize`'s fallback.
    const routerNode = definition.nodes.find((node) => node.id === 'router')
    expect(routerNode).toBeDefined()
    if (routerNode) {
      expect(routerSize?.height).toBeGreaterThan(measureWorkflowNodeSize(routerNode).height)
    }

    // The real "Re-layout" path: the reducer passes this same map into computeAutoLayout.
    const withMeasured = computeAutoLayout(definition.nodes, definition.edges, {
      measuredSizes: sizes
    })
    const withEstimate = computeAutoLayout(definition.nodes, definition.edges)
    expect(withMeasured.start.y).not.toEqual(withEstimate.start.y)
  })
})
