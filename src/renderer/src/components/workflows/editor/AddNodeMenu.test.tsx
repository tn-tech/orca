// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddableNodeKind } from './workflow-new-node-defaults'

type MenuItemProps = { children?: ReactNode; onSelect?: () => void }

vi.mock('@/components/ui/dropdown-menu', async () => {
  const React_ = await import('react')
  const passthrough = ({ children }: { children?: ReactNode }) =>
    React_.createElement(React_.Fragment, null, children)
  return {
    DropdownMenu: passthrough,
    DropdownMenuTrigger: passthrough,
    DropdownMenuContent: passthrough,
    // A real `role="menuitem"` button (unlike the other passthroughs) so a test can pick an item
    // by its accessible name (the label text; icons carry `aria-hidden`) instead of render order.
    DropdownMenuItem: ({ children, onSelect }: MenuItemProps) =>
      React_.createElement(
        'button',
        { type: 'button', role: 'menuitem', onClick: () => onSelect?.() },
        children
      )
  }
})

import AddNodeMenu from './AddNodeMenu'

afterEach(() => {
  cleanup()
})

describe('AddNodeMenu', () => {
  it('lists every addable kind except Loop when no Start node exists yet', () => {
    render(<AddNodeMenu hasStartNode={false} onAddNode={vi.fn()} />)

    expect(screen.getByRole('menuitem', { name: 'Start' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Agent' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Router' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Join' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Approval' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Reflection' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'End' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Loop' })).not.toBeInTheDocument()
  })

  it('excludes Start once one already exists (only one is allowed, graph_multiple_start_nodes)', () => {
    render(<AddNodeMenu hasStartNode={true} onAddNode={vi.fn()} />)

    expect(screen.queryByRole('menuitem', { name: 'Start' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Agent' })).toBeInTheDocument()
  })

  it('calls onAddNode with the chosen kind when a menu item is selected, picked by its label', () => {
    const onAddNode = vi.fn<(kind: AddableNodeKind) => void>()
    render(<AddNodeMenu hasStartNode={false} onAddNode={onAddNode} />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Agent' }))
    expect(onAddNode).toHaveBeenCalledWith('agent')

    fireEvent.click(screen.getByRole('menuitem', { name: 'End' }))
    expect(onAddNode).toHaveBeenCalledWith('end')
  })
})
