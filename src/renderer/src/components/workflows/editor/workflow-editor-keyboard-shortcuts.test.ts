// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import {
  isWorkflowEditorDeleteShortcut,
  isWorkflowEditorUndoShortcut,
  shouldIgnoreWorkflowEditorShortcut,
  useWorkflowEditorKeyboardShortcuts
} from './workflow-editor-keyboard-shortcuts'

function key(
  patch: Partial<{
    key: string
    metaKey: boolean
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
  }> = {}
): { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean } {
  return { key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...patch }
}

describe('isWorkflowEditorDeleteShortcut', () => {
  it('matches a bare Delete or Backspace press', () => {
    expect(isWorkflowEditorDeleteShortcut(key({ key: 'Delete' }))).toBe(true)
    expect(isWorkflowEditorDeleteShortcut(key({ key: 'Backspace' }))).toBe(true)
  })

  it('ignores Delete/Backspace held with a modifier', () => {
    expect(isWorkflowEditorDeleteShortcut(key({ key: 'Backspace', metaKey: true }))).toBe(false)
    expect(isWorkflowEditorDeleteShortcut(key({ key: 'Delete', shiftKey: true }))).toBe(false)
  })

  it('ignores every other key', () => {
    expect(isWorkflowEditorDeleteShortcut(key({ key: 'a' }))).toBe(false)
  })
})

describe('isWorkflowEditorUndoShortcut', () => {
  it('matches Cmd+Z on Mac, not Ctrl+Z', () => {
    expect(isWorkflowEditorUndoShortcut(key({ key: 'z', metaKey: true }), true)).toBe(true)
    expect(isWorkflowEditorUndoShortcut(key({ key: 'z', ctrlKey: true }), true)).toBe(false)
  })

  it('matches Ctrl+Z on Linux/Windows, not Cmd+Z', () => {
    expect(isWorkflowEditorUndoShortcut(key({ key: 'z', ctrlKey: true }), false)).toBe(true)
    expect(isWorkflowEditorUndoShortcut(key({ key: 'z', metaKey: true }), false)).toBe(false)
  })

  it('never matches with Shift held (no redo)', () => {
    expect(
      isWorkflowEditorUndoShortcut(key({ key: 'z', metaKey: true, shiftKey: true }), true)
    ).toBe(false)
  })

  it('is case-insensitive on the key', () => {
    expect(isWorkflowEditorUndoShortcut(key({ key: 'Z', metaKey: true }), true)).toBe(true)
  })
})

describe('shouldIgnoreWorkflowEditorShortcut', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('ignores an editable target', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)

    expect(shouldIgnoreWorkflowEditorShortcut(input)).toBe(true)
  })

  it('ignores every target while a dialog is open', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const outsideTarget = document.createElement('div')
    document.body.append(dialog, outsideTarget)

    expect(shouldIgnoreWorkflowEditorShortcut(outsideTarget)).toBe(true)
  })

  it('does not ignore a plain canvas target with no dialog open', () => {
    const canvas = document.createElement('div')
    document.body.appendChild(canvas)

    expect(shouldIgnoreWorkflowEditorShortcut(canvas)).toBe(false)
  })
})

describe('useWorkflowEditorKeyboardShortcuts', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  function fireKeydown(init: KeyboardEventInit): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, ...init }))
  }

  it('calls onDelete for a bare Backspace when a selection exists', () => {
    const onDelete = vi.fn()
    renderHook(() =>
      useWorkflowEditorKeyboardShortcuts({
        enabled: true,
        canDelete: true,
        canUndo: false,
        onDelete,
        onUndo: vi.fn()
      })
    )

    act(() => fireKeydown({ key: 'Backspace' }))

    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('does not call onDelete when nothing is selected', () => {
    const onDelete = vi.fn()
    renderHook(() =>
      useWorkflowEditorKeyboardShortcuts({
        enabled: true,
        canDelete: false,
        canUndo: false,
        onDelete,
        onUndo: vi.fn()
      })
    )

    act(() => fireKeydown({ key: 'Backspace' }))

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('calls onUndo for the platform undo chord (the hook defers to the running platform)', () => {
    const onUndo = vi.fn()
    const isMac = getShortcutPlatform() === 'darwin'
    renderHook(() =>
      useWorkflowEditorKeyboardShortcuts({
        enabled: true,
        canDelete: false,
        canUndo: true,
        onDelete: vi.fn(),
        onUndo
      })
    )

    act(() => fireKeydown({ key: 'z', metaKey: isMac, ctrlKey: !isMac }))

    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('never dispatches while focus is on an input (typing a node title)', () => {
    const onDelete = vi.fn()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    renderHook(() =>
      useWorkflowEditorKeyboardShortcuts({
        enabled: true,
        canDelete: true,
        canUndo: false,
        onDelete,
        onUndo: vi.fn()
      })
    )

    act(() =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    )

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('does nothing when disabled (no workflow open)', () => {
    const onDelete = vi.fn()
    renderHook(() =>
      useWorkflowEditorKeyboardShortcuts({
        enabled: false,
        canDelete: true,
        canUndo: false,
        onDelete,
        onUndo: vi.fn()
      })
    )

    act(() => fireKeydown({ key: 'Backspace' }))

    expect(onDelete).not.toHaveBeenCalled()
  })
})
