// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddableNodeKind } from './workflow-new-node-defaults'

type MenuItemProps = { children?: ReactNode; onSelect?: () => void }

const menuItems = vi.hoisted(() => {
  const values: MenuItemProps[] = []
  return { values }
})

vi.mock('@/components/ui/dropdown-menu', async () => {
  const React_ = await import('react')
  const passthrough = ({ children }: { children?: ReactNode }) =>
    React_.createElement(React_.Fragment, null, children)
  return {
    DropdownMenu: passthrough,
    DropdownMenuTrigger: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: (props: MenuItemProps) => {
      menuItems.values.push(props)
      // A real wrapping element (unlike the other passthroughs) so each item's label text is its
      // own match target instead of merging into one big sibling text run under the container.
      return React_.createElement('div', null, props.children)
    }
  }
})

import AddNodeMenu from './AddNodeMenu'

afterEach(() => {
  cleanup()
  menuItems.values = []
})

describe('AddNodeMenu', () => {
  it('lists every addable kind except Loop when no Start node exists yet', () => {
    render(<AddNodeMenu hasStartNode={false} onAddNode={vi.fn()} />)

    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('Router')).toBeInTheDocument()
    expect(screen.getByText('Join')).toBeInTheDocument()
    expect(screen.getByText('Approval')).toBeInTheDocument()
    expect(screen.getByText('Reflection')).toBeInTheDocument()
    expect(screen.getByText('End')).toBeInTheDocument()
    expect(screen.queryByText('Loop')).not.toBeInTheDocument()
  })

  it('excludes Start once one already exists (only one is allowed, graph_multiple_start_nodes)', () => {
    render(<AddNodeMenu hasStartNode={true} onAddNode={vi.fn()} />)

    expect(screen.queryByText('Start')).not.toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
  })

  it('calls onAddNode with the chosen kind when a menu item is selected', () => {
    const onAddNode = vi.fn<(kind: AddableNodeKind) => void>()
    render(<AddNodeMenu hasStartNode={false} onAddNode={onAddNode} />)

    // Rendered in ADDABLE_NODE_KINDS order (start, agent, router, join, approval, reflection,
    // end); index 1 is Agent when Start is included.
    menuItems.values[1]?.onSelect?.()
    expect(onAddNode).toHaveBeenCalledWith('agent')

    menuItems.values[6]?.onSelect?.()
    expect(onAddNode).toHaveBeenCalledWith('end')
  })
})
