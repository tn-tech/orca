import { describe, expect, it } from 'vitest'
import { skillMdCandidates, skillMdDeclaresName } from './workflow-skill-md-location'

describe('skillMdCandidates (skills CLI 1.7.0 layout)', () => {
  it('orders the root, then skills/ containers, then agent skill dirs; file order within each', () => {
    expect(
      skillMdCandidates([
        '.claude/skills/c/SKILL.md',
        'skills/group/b/SKILL.md',
        'skills/a/SKILL.md',
        'SKILL.md',
        'docs/deep/x/SKILL.md'
      ])
    ).toEqual([
      'SKILL.md',
      'skills/group/b/SKILL.md',
      'skills/a/SKILL.md',
      '.claude/skills/c/SKILL.md'
    ])
  })

  it('skips skills nested under another skill and under build dirs', () => {
    expect(
      skillMdCandidates([
        'skills/a/SKILL.md',
        'skills/a/sub/SKILL.md',
        'skills/node_modules/x/SKILL.md'
      ])
    ).toEqual(['skills/a/SKILL.md'])
  })

  it('falls back to any SKILL.md at most six segments deep', () => {
    expect(skillMdCandidates(['a/b/c/d/e/SKILL.md', 'a/b/c/d/e/f/SKILL.md', 'README.md'])).toEqual([
      'a/b/c/d/e/SKILL.md'
    ])
  })
})

describe('skillMdDeclaresName', () => {
  it('matches the frontmatter name case-insensitively', () => {
    expect(skillMdDeclaresName('---\nname: Plan\ndescription: d\n---\nbody', 'plan')).toBe(true)
    expect(skillMdDeclaresName('---\nname: other\n---\n', 'plan')).toBe(false)
    expect(skillMdDeclaresName('no frontmatter', 'plan')).toBe(false)
    expect(skillMdDeclaresName('---\n: [bad\n---\n', 'plan')).toBe(false)
  })
})
