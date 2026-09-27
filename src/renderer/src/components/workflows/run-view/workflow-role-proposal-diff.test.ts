import { describe, expect, it } from 'vitest'
import type { Role } from '../../../../../shared/workflows/workflow-definition-types'
import type { RoleProposalChange } from '../../../../../shared/workflows/workflow-run-types'
import {
  diffLineCounts,
  roleProposalFieldDiffs,
  textFieldDiffLines
} from './workflow-role-proposal-diff'

function role(patch: Partial<Role> = {}): Role {
  return {
    id: 'reviewer',
    name: 'Reviewer',
    agent: 'claude',
    systemPrompt: 'Review the change.\nCheck for regressions.',
    skills: [],
    ...patch
  }
}

describe('textFieldDiffLines', () => {
  it('marks a fully replaced value as one del and one add line', () => {
    expect(textFieldDiffLines('old value', 'new value')).toEqual([
      { kind: 'del', text: 'old value' },
      { kind: 'add', text: 'new value' }
    ])
  })

  it('keeps a common prefix and suffix as context, marking only the changed middle', () => {
    const before = 'line 1\nline 2\nline 3\nline 4'
    const after = 'line 1\nCHANGED\nline 4'

    expect(textFieldDiffLines(before, after)).toEqual([
      { kind: 'context', text: 'line 1' },
      { kind: 'del', text: 'line 2' },
      { kind: 'del', text: 'line 3' },
      { kind: 'add', text: 'CHANGED' },
      { kind: 'context', text: 'line 4' }
    ])
  })

  it('collapses a long unchanged lead/trail behind a meta marker (engine CONTEXT_LINES=3 convention)', () => {
    const commonLead = ['a', 'b', 'c', 'd', 'e'].join('\n')
    const commonTrail = ['v', 'w', 'x', 'y', 'z'].join('\n')
    const before = `${commonLead}\nOLD\n${commonTrail}`
    const after = `${commonLead}\nNEW\n${commonTrail}`

    const lines = textFieldDiffLines(before, after)

    expect(lines[0]).toEqual({ kind: 'meta', text: '… 2 unchanged lines …' })
    expect(lines.slice(1, 4)).toEqual([
      { kind: 'context', text: 'c' },
      { kind: 'context', text: 'd' },
      { kind: 'context', text: 'e' }
    ])
    expect(lines[4]).toEqual({ kind: 'del', text: 'OLD' })
    expect(lines[5]).toEqual({ kind: 'add', text: 'NEW' })
    expect(lines.slice(6, 9)).toEqual([
      { kind: 'context', text: 'v' },
      { kind: 'context', text: 'w' },
      { kind: 'context', text: 'x' }
    ])
    expect(lines[9]).toEqual({ kind: 'meta', text: '… 2 unchanged lines …' })
  })

  it('uses singular copy for exactly one collapsed line', () => {
    const before = ['a', 'b', 'c', 'd', 'OLD'].join('\n')
    const after = ['a', 'b', 'c', 'd', 'NEW'].join('\n')

    const lines = textFieldDiffLines(before, after)

    expect(lines[0]).toEqual({ kind: 'meta', text: '… 1 unchanged line …' })
  })

  it('returns only context lines for two identical values', () => {
    expect(textFieldDiffLines('same', 'same')).toEqual([{ kind: 'context', text: 'same' }])
  })
})

describe('diffLineCounts', () => {
  it('counts added and removed lines, ignoring context and meta', () => {
    const lines = textFieldDiffLines('a\nb\nc', 'a\nCHANGED\nc')

    expect(diffLineCounts(lines)).toEqual({ added: 1, removed: 1 })
  })
})

describe('roleProposalFieldDiffs', () => {
  it('diffs only the fields the proposal sets', () => {
    const change: RoleProposalChange = { systemPrompt: 'Review the change.\nCheck coverage too.' }

    const diffs = roleProposalFieldDiffs(role(), change)

    expect(diffs).toHaveLength(1)
    expect(diffs[0]?.field).toBe('systemPrompt')
    expect(diffs[0]?.lines).toContainEqual({ kind: 'del', text: 'Check for regressions.' })
    expect(diffs[0]?.lines).toContainEqual({ kind: 'add', text: 'Check coverage too.' })
  })

  it('diffs skills as one formatted line per skill', () => {
    const change: RoleProposalChange = {
      skills: [
        { name: 'lint', source: { kind: 'plugin', plugin: 'lint-plugin' }, required: true },
        {
          name: 'deploy',
          source: { kind: 'repository', location: 'org/deploy-skill', version: 'v2' },
          required: true
        }
      ]
    }

    const diffs = roleProposalFieldDiffs(role({ skills: [] }), change)

    expect(diffs).toHaveLength(1)
    expect(diffs[0]?.field).toBe('skills')
    expect(diffs[0]?.lines.some((line) => line.kind === 'add' && line.text.includes('lint'))).toBe(
      true
    )
    expect(
      diffs[0]?.lines.some((line) => line.kind === 'add' && line.text.includes('deploy'))
    ).toBe(true)
  })

  it('treats a missing baseline role as an empty value', () => {
    const change: RoleProposalChange = { systemPrompt: 'Brand new prompt.' }

    const diffs = roleProposalFieldDiffs(undefined, change)

    expect(diffs[0]?.lines).toContainEqual({ kind: 'add', text: 'Brand new prompt.' })
    expect(diffs[0]?.lines.some((line) => line.kind === 'del')).toBe(false)
  })

  it('returns no diffs for an empty change', () => {
    expect(roleProposalFieldDiffs(role(), {})).toEqual([])
  })
})
