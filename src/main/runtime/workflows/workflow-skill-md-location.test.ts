import { describe, expect, it } from 'vitest'
import { locateSkillMd } from './workflow-skill-md-location'

function skillMd(name: string, description: string | null = `${name} skill`): string {
  return description === null
    ? `---\nname: ${name}\n---\nbody`
    : `---\nname: ${name}\ndescription: ${description}\n---\nbody`
}

function checkout(files: Record<string, string>) {
  return {
    paths: Object.keys(files),
    readText: async (path: string) => files[path] ?? null
  }
}

async function located(files: Record<string, string>, name: string) {
  return (await locateSkillMd(checkout(files), name))?.path
}

describe('locateSkillMd (skills CLI 1.7.0 discoverSkills, clone path)', () => {
  it('returns only the root skill when the root has a valid SKILL.md', async () => {
    const files = { 'SKILL.md': skillMd('root'), 'skills/plan/SKILL.md': skillMd('plan') }
    expect(await located(files, 'plan')).toBeUndefined()
    expect(await located(files, 'ROOT')).toBe('SKILL.md')
  })

  it('searches on when the root SKILL.md is invalid', async () => {
    const files = { 'SKILL.md': skillMd('root', null), 'skills/plan/SKILL.md': skillMd('plan') }
    expect(await located(files, 'plan')).toBe('skills/plan/SKILL.md')
  })

  it('searches skill dirs declared by a plugin marketplace manifest', async () => {
    const files = {
      '.claude-plugin/marketplace.json': JSON.stringify({
        plugins: [{ name: 'p', source: './plugins/p' }]
      }),
      'plugins/p/skills/plan/SKILL.md': skillMd('plan'),
      // A priority-dir skill means the deep fallback walk never runs.
      'skills/other/SKILL.md': skillMd('other')
    }
    expect(await located(files, 'plan')).toBe('plugins/p/skills/plan/SKILL.md')
    const withoutManifest = { ...files, '.claude-plugin/marketplace.json': '{}' }
    expect(await located(withoutManifest, 'plan')).toBeUndefined()
  })

  it('searches the parent of each skill path a plugin.json declares', async () => {
    const files = {
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'p', skills: ['./extras/plan'] }),
      'extras/plan/SKILL.md': skillMd('plan'),
      'skills/other/SKILL.md': skillMd('other')
    }
    expect(await located(files, 'plan')).toBe('extras/plan/SKILL.md')
  })

  it('skips a SKILL.md without a description, as the CLI does', async () => {
    expect(await located({ 'skills/plan/SKILL.md': skillMd('plan', null) }, 'plan')).toBeUndefined()
  })

  it('walks containers three levels deep but other priority dirs one level', async () => {
    const files = {
      'skills/a/b/plan/SKILL.md': skillMd('plan'),
      'nested/review/SKILL.md': skillMd('review'),
      'deep/x/review/SKILL.md': skillMd('review-deep')
    }
    expect(await located(files, 'plan')).toBe('skills/a/b/plan/SKILL.md')
    // The root is walked one level, and a priority hit stops the deep fallback.
    expect(await located(files, 'review-deep')).toBeUndefined()
  })

  it('falls back to any SKILL.md at most five directories deep when nothing else matched', async () => {
    expect(await located({ 'a/b/c/d/plan/SKILL.md': skillMd('plan') }, 'plan')).toBe(
      'a/b/c/d/plan/SKILL.md'
    )
    expect(await located({ 'a/b/c/d/e/plan/SKILL.md': skillMd('plan') }, 'plan')).toBeUndefined()
    expect(
      await located({ 'node_modules/x/plan/SKILL.md': skillMd('plan') }, 'plan')
    ).toBeUndefined()
  })

  it('skips an installed copy recorded in skills-lock.json', async () => {
    const files = {
      'skills-lock.json': JSON.stringify({ version: 1, skills: { plan: {} } }),
      '.claude/skills/plan/SKILL.md': skillMd('plan'),
      'skills/other/SKILL.md': skillMd('other')
    }
    expect(await located(files, 'plan')).toBeUndefined()
  })
})
