import { describe, expect, it } from 'vitest'
import { TopLevelViewSchema, UiUpdateFields } from './client-ui-params'

describe('TopLevelViewSchema', () => {
  it('parses every known view as itself, including workflows', () => {
    for (const view of [
      'terminal',
      'settings',
      'tasks',
      'activity',
      'automations',
      'workflows',
      'space',
      'skills',
      'artifacts',
      'mobile'
    ] as const) {
      expect(TopLevelViewSchema.parse(view)).toBe(view)
    }
  })

  it('degrades an unrecognized view to terminal instead of rejecting it', () => {
    // Why: Rule 4 (remote-wire-compatibility.md) — an older host parsing a newer
    // client's activeView must not sink the whole ui.set payload for one unknown arm.
    expect(TopLevelViewSchema.parse('workflows-canvas')).toBe('terminal')
  })
})

describe('UiUpdateFields activeView', () => {
  it('keeps a known activeView, including workflows, alongside other fields', () => {
    const parsed = UiUpdateFields.parse({ activeView: 'workflows', sidebarWidth: 240 })
    expect(parsed).toEqual({ activeView: 'workflows', sidebarWidth: 240 })
  })

  it('degrades an unrecognized activeView to terminal without rejecting the rest of the payload', () => {
    const parsed = UiUpdateFields.parse({ activeView: 'workflows-canvas', sidebarWidth: 240 })
    expect(parsed).toEqual({ activeView: 'terminal', sidebarWidth: 240 })
  })
})
