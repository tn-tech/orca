import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'
import { provisionNodeSkills } from './workflow-skill-provisioning'
import { createSkillPorts, skillInput } from './workflow-skill-provisioning-test-fixtures'

const pluginSkill = (required: boolean): SkillReference => ({
  name: 'deck-writer',
  source: { kind: 'plugin', plugin: 'acme-decks' },
  required
})

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-skill-plugin-phase-'))
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('provisionNodeSkills — verify-only plugin providers', () => {
  it('fails a required skill with install instructions before asking for trust', async () => {
    const { ports, plugins, trustGate } = createSkillPorts(workspaceRoot, null)
    plugins.unavailableReason.mockReturnValue('Install plugin "acme-decks" yourself.')

    const outcome = await provisionNodeSkills(
      skillInput(workspaceRoot, { agent: 'codex', skills: [pluginSkill(true)] }),
      ports
    )

    expect(outcome).toEqual({ kind: 'failed', reason: 'Install plugin "acme-decks" yourself.' })
    expect(trustGate.decide).not.toHaveBeenCalled()
    expect(plugins.install).not.toHaveBeenCalled()
  })

  it('drops an optional skill it cannot install without blocking the node', async () => {
    const { ports, plugins, trustGate } = createSkillPorts(workspaceRoot, null)
    plugins.unavailableReason.mockReturnValue('Install it yourself.')

    const outcome = await provisionNodeSkills(
      skillInput(workspaceRoot, { agent: 'codex', skills: [pluginSkill(false)] }),
      ports
    )

    expect(outcome).toEqual({ kind: 'ready', installed: [] })
    expect(trustGate.decide).not.toHaveBeenCalled()
  })
})

describe('provisionNodeSkills — verifying a plugin install', () => {
  it('fails when the install succeeds but the skill is still not available', async () => {
    const { ports, plugins } = createSkillPorts(workspaceRoot, null, { trust: 'trusted' })
    plugins.isInstalled.mockResolvedValue(false)

    const outcome = await provisionNodeSkills(
      skillInput(workspaceRoot, { skills: [pluginSkill(true)] }),
      ports
    )

    expect(outcome.kind).toBe('failed')
    expect(outcome.kind === 'failed' && outcome.reason).toContain('still not available')
  })
})
