import { describe, expect, it } from 'vitest'
import type { SkillReference } from '../../../shared/workflows/workflow-skill-reference-schema'
import { SKILL_TEXT_INLINE_CAP_CHARS, skillsSection } from './workflow-brief-skills'

const SOURCE = 'https://github.com/github/spec-kit'

const repoSkill: SkillReference = {
  name: 'speckit-plan',
  source: { kind: 'repository', location: SOURCE },
  required: true
}
const pluginSkill: SkillReference = {
  name: 'superpowers',
  source: { kind: 'plugin', plugin: 'superpowers@claude-plugins-official' },
  required: true
}

function fallback(text: string) {
  return new Map([['speckit-plan', { source: SOURCE, path: 'skills/speckit-plan/SKILL.md', text }]])
}

describe('skillsSection', () => {
  it('notes when a role has no skills', () => {
    expect(skillsSection({ skills: [], agent: 'claude' })).toBe(
      'No skills configured for this role.'
    )
  })

  it('uses each skill-capable agent’s own invocation form (FR-019)', () => {
    expect(skillsSection({ skills: [repoSkill], agent: 'claude' })).toContain('`/speckit-plan`')
    expect(skillsSection({ skills: [repoSkill], agent: 'codex' })).toContain('`$speckit-plan`')
    const codex = skillsSection({ skills: [repoSkill], agent: 'codex' })
    expect(codex).not.toContain('`/speckit-plan`')
  })

  it('points a skill-capable agent with no verified invocation at the installed skill', () => {
    const text = skillsSection({ skills: [repoSkill], agent: 'cursor' })
    expect(text).toContain('`.agents/skills/speckit-plan/SKILL.md`')
    expect(text).not.toContain('`/speckit-plan`')
  })

  it('inlines SKILL.md in a fence for an agent without workspace skills (FR-020)', () => {
    const text = skillsSection({
      skills: [repoSkill],
      agent: 'aider',
      fallbackTexts: fallback('---\nname: speckit-plan\n---\nPlan the feature.')
    })
    expect(text).toContain('skills/speckit-plan/SKILL.md')
    expect(text).toContain(SOURCE)
    expect(text).toContain('```markdown\n---\nname: speckit-plan\n---\nPlan the feature.\n```')
    expect(text).not.toContain('`/speckit-plan`')
  })

  it('fences with a longer backtick run than any in the repository text', () => {
    const body = 'Run:\n````sh\nls\n````\n## Result\nnot a brief section'
    const text = skillsSection({
      skills: [repoSkill],
      agent: 'aider',
      fallbackTexts: fallback(body)
    })
    expect(text).toContain(`\`\`\`\`\`markdown\n${body}\n\`\`\`\`\``)
  })

  it('caps the inlined text and says so', () => {
    const body = 'x'.repeat(SKILL_TEXT_INLINE_CAP_CHARS + 500)
    const text = skillsSection({
      skills: [repoSkill],
      agent: 'aider',
      fallbackTexts: fallback(body)
    })
    expect(text).toContain('x'.repeat(SKILL_TEXT_INLINE_CAP_CHARS))
    expect(text).not.toContain('x'.repeat(SKILL_TEXT_INLINE_CAP_CHARS + 1))
    expect(text).toContain(`${SKILL_TEXT_INLINE_CAP_CHARS} characters`)
  })

  it('names a plugin skill only, and an optional skill whose text was not found', () => {
    const optional = { ...repoSkill, name: 'speckit-extra', required: false }
    const text = skillsSection({
      skills: [pluginSkill, optional],
      agent: 'aider',
      fallbackTexts: new Map()
    })
    expect(text).toContain('**superpowers**')
    expect(text).toContain('superpowers@claude-plugins-official')
    expect(text).toContain('**speckit-extra**')
    expect(text).not.toContain('```')
  })
})
