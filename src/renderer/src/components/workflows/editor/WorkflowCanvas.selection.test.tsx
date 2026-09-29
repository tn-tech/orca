// @vitest-environment happy-dom
// Real @xyflow/react, wired the way WorkflowsPage wires it (controlled selection, inline edge
// handler). React Flow re-sends its one-render-stale selection whenever `onSelectionChange`
// changes identity, so any handler that forwards it ping-pongs between selections (F9).
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import WorkflowCanvas from './WorkflowCanvas'

class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function definitionWith(extraNodeIds: string[]): Workflow {
  const nodes: Workflow['nodes'] = [
    { id: 'start', type: 'start', title: 'Start' },
    { id: 'end', type: 'end', title: 'End' },
    ...extraNodeIds.map((id) => ({ id, type: 'end' as const, title: id }))
  ]
  return {
    version: 1,
    name: 'selection-test',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes,
    edges: [{ id: 'e1', from: 'start', to: 'end' }],
    layout: Object.fromEntries(nodes.map((node, i) => [node.id, { x: i * 300, y: 0 }]))
  }
}

type StoreDriver = {
  addSelectedNodes: (ids: string[]) => void
  addSelectedEdges: (ids: string[]) => void
}
type PageDriver = {
  selectProgrammatically: (id: string) => void
  deleteSelectedNode: () => void
  addNode: () => void
}
const storeDriver: { current: StoreDriver | null } = { current: null }
const pageDriver: { current: PageDriver | null } = { current: null }

function StoreGrab(): null {
  const store = useStoreApi()
  storeDriver.current = {
    addSelectedNodes: (ids) => store.getState().addSelectedNodes(ids),
    addSelectedEdges: (ids) => store.getState().addSelectedEdges(ids)
  }
  return null
}

/** The same selection wiring as WorkflowsPage + use-workflows-page-controller. */
function Harness(): React.JSX.Element {
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>()
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>()
  const [extra, setExtra] = useState<string[]>(['other'])
  const selectNode = (nodeId: string | undefined): void => {
    setSelectedNodeId(nodeId)
    if (nodeId) {
      setSelectedEdgeId(undefined)
    }
  }
  pageDriver.current = {
    selectProgrammatically: selectNode,
    deleteSelectedNode: () => {
      setExtra((ids) => ids.filter((id) => id !== selectedNodeId))
      setSelectedNodeId(undefined)
    },
    addNode: () => {
      setExtra((ids) => [...ids, 'added'])
      selectNode('added')
    }
  }
  return (
    <ReactFlowProvider>
      <StoreGrab />
      <div data-testid="state">{`${selectedNodeId ?? '-'}|${selectedEdgeId ?? '-'}`}</div>
      <WorkflowCanvas
        definition={definitionWith(extra)}
        selectedNodeId={selectedNodeId}
        selectedEdgeId={selectedEdgeId}
        onNodeSelect={selectNode}
        onEdgeSelect={(edgeId) => {
          setSelectedEdgeId(edgeId)
          if (edgeId) {
            setSelectedNodeId(undefined)
          }
        }}
      />
    </ReactFlowProvider>
  )
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  storeDriver.current = null
  pageDriver.current = null
  host = document.createElement('div')
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800))
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('react-flow') ? 1200 : 200
    }
  )
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('react-flow') ? 800 : 60
    }
  )
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<Harness />)
  })
}

async function settle(fn: () => void): Promise<void> {
  await act(async () => {
    fn()
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

function state(): string | null {
  return host.querySelector('[data-testid="state"]')?.textContent ?? null
}

function clickNode(id: string): void {
  const node = host.querySelector(`.react-flow__node[data-id="${id}"]`)
  if (!node) {
    throw new Error(`node ${id} not rendered`)
  }
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('WorkflowCanvas selection (real React Flow)', () => {
  it('selects a node when nothing is selected', async () => {
    await mount()
    await settle(() => clickNode('start'))
    expect(state()).toBe('start|-')
  })

  it('moves the selection from one node to another without an update loop', async () => {
    await mount()
    await settle(() => clickNode('start'))
    await settle(() => clickNode('end'))
    expect(state()).toBe('end|-')
  })

  it('moves the selection from a node to an edge and back', async () => {
    await mount()
    await settle(() => clickNode('start'))
    await settle(() => storeDriver.current?.addSelectedEdges(['e1']))
    expect(state()).toBe('-|e1')
    await settle(() => clickNode('end'))
    expect(state()).toBe('end|-')
  })

  it('deselects on a pane click', async () => {
    await mount()
    await settle(() => clickNode('start'))
    const pane = host.querySelector('.react-flow__pane')
    expect(pane).not.toBeNull()
    await settle(() => pane?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(state()).toBe('-|-')
  })

  it('does not re-select a node that was just deleted', async () => {
    await mount()
    await settle(() => clickNode('other'))
    expect(state()).toBe('other|-')
    await settle(() => pageDriver.current?.deleteSelectedNode())
    expect(state()).toBe('-|-')
  })

  it('selects a node added while another is selected (addNode)', async () => {
    await mount()
    await settle(() => clickNode('start'))
    await settle(() => pageDriver.current?.addNode())
    expect(state()).toBe('added|-')
  })

  it('follows a programmatic selection made while another node is selected (focusProblem, prompt jump)', async () => {
    await mount()
    await settle(() => clickNode('start'))
    await settle(() => pageDriver.current?.selectProgrammatically('end'))
    expect(state()).toBe('end|-')
  })

  it('still selects from keyboard-style selection changes (F4)', async () => {
    await mount()
    await settle(() => storeDriver.current?.addSelectedNodes(['start']))
    expect(state()).toBe('start|-')
    await settle(() => storeDriver.current?.addSelectedEdges(['e1']))
    expect(state()).toBe('-|e1')
  })
})
