// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { SkillReference } from '../../../../../shared/workflows/workflow-definition-types'
import SkillReferenceList, { type SkillReferenceListProps } from './SkillReferenceList'

afterEach(() => {
  cleanup()
})

function pluginSkill(patch: Partial<SkillReference> = {}): SkillReference {
  return {
    name: 'speckit-plan',
    source: { kind: 'plugin', plugin: 'speckit' },
    required: true,
    ...patch
  }
}

function renderList(props: SkillReferenceListProps): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <SkillReferenceList {...props} />
    </TooltipProvider>
  )
}

describe('SkillReferenceList (FR-015)', () => {
  it('adds a blank plugin-sourced skill', () => {
    const onChange = vi.fn()
    renderList({ skills: [], onChange })

    fireEvent.click(screen.getByRole('button', { name: 'Add skill' }))

    expect(onChange).toHaveBeenLastCalledWith([
      { name: '', source: { kind: 'plugin', plugin: '' }, required: true }
    ])
  })

  it('renames a skill', () => {
    const onChange = vi.fn()
    renderList({ skills: [pluginSkill()], onChange })

    fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'renamed' } })

    expect(onChange).toHaveBeenLastCalledWith([
      { name: 'renamed', source: { kind: 'plugin', plugin: 'speckit' }, required: true }
    ])
  })

  it('switching source kind to repository resets the source shape', () => {
    const onChange = vi.fn()
    renderList({ skills: [pluginSkill()], onChange })

    fireEvent.click(screen.getByRole('combobox', { name: 'Source' }))
    fireEvent.click(screen.getByRole('option', { name: 'Repository' }))

    expect(onChange).toHaveBeenLastCalledWith([
      { name: 'speckit-plan', source: { kind: 'repository', location: '' }, required: true }
    ])
  })

  it('removes a skill', () => {
    const onChange = vi.fn()
    renderList({ skills: [pluginSkill()], onChange })

    fireEvent.click(screen.getByRole('button', { name: 'Remove skill' }))

    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('flags a repository source not on the project allowlist', () => {
    renderList({
      skills: [
        {
          name: 'plan',
          source: { kind: 'repository', location: 'https://example.com/not-allowlisted' },
          required: true
        }
      ],
      onChange: vi.fn(),
      allowlistedSources: ['https://example.com/allowed']
    })

    expect(screen.getByText('https://example.com/not-allowlisted')).toBeInTheDocument()
  })

  it('offers a Trust action on a named plugin skill when the caller wants one', () => {
    const onRequestTrust = vi.fn()
    renderList({ skills: [pluginSkill()], onChange: vi.fn(), onRequestTrust })

    fireEvent.click(screen.getByRole('button', { name: 'Trust…' }))

    expect(onRequestTrust).toHaveBeenCalledWith({ kind: 'plugin', plugin: 'speckit' })
  })

  it('keeps an existing row mounted (no lost focus) when skills grows from outside', () => {
    // Reproduces the reported bug: a node with no skills gets a role assigned that has some, so
    // `skills` lengthens from a prop change, not from `addSkill`/`removeSkill`.
    const { rerender } = renderList({ skills: [], onChange: vi.fn() })

    rerender(
      <TooltipProvider>
        <SkillReferenceList skills={[pluginSkill()]} onChange={vi.fn()} />
      </TooltipProvider>
    )
    const nameInput = screen.getByLabelText('Skill name')
    nameInput.focus()
    expect(document.activeElement).toBe(nameInput)

    // A second, unrelated re-render (e.g. the parent re-rendering after some other state change)
    // must not remount the row a second time either — the bug regenerated a fresh key on every
    // render once the list had grown past what was seeded at mount.
    rerender(
      <TooltipProvider>
        <SkillReferenceList skills={[pluginSkill({ name: 'a' })]} onChange={vi.fn()} />
      </TooltipProvider>
    )

    expect(document.activeElement).toBe(nameInput)
  })
})
