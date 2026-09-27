import { describe, expect, it } from 'vitest'
import { isWorkflowPluginId } from './workflow-plugin-id'
import { SkillReferenceSchema } from './workflow-skill-reference-schema'

const withPlugin = (plugin: string) =>
  SkillReferenceSchema.safeParse({ name: 'deck-writer', source: { kind: 'plugin', plugin } })

describe('workflow plugin ids', () => {
  it('accepts name and name@marketplace', () => {
    for (const id of ['acme-decks', 'acme-decks@acme', 'superpowers', 'a.b_c-1@market.place']) {
      expect(isWorkflowPluginId(id), id).toBe(true)
      expect(withPlugin(id).success, id).toBe(true)
    }
  })

  it('refuses an id the plugin CLI would read as an option', () => {
    expect(isWorkflowPluginId('--scope=project')).toBe(false)
    const parsed = withPlugin('-y')
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toContain('name@marketplace')
  })

  it('refuses ids shaped like an encoded trust key or with other characters', () => {
    for (const id of ['["ssh:devbox","acme"]', '[acme', 'acme@', '@acme', 'a b', 'a/b', 'a@b@c']) {
      expect(isWorkflowPluginId(id), id).toBe(false)
      expect(withPlugin(id).success, id).toBe(false)
    }
  })
})
