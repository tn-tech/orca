import { describe, expect, it } from 'vitest'
import type { AgentNode } from '../../../../../shared/workflows/workflow-definition-types'
import {
  agentLacksWorkspaceSkillSupport,
  isRoleFieldOverridden,
  revertRoleField,
  ROLE_OVERRIDABLE_FIELDS
} from './role-override-state'

function agentNode(patch: Partial<AgentNode> = {}): AgentNode {
  return {
    id: 'implement',
    type: 'agent',
    title: 'Implement',
    prompt: 'Build it.',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 600_000, escalationGraceMs: 300_000 },
    ...patch
  }
}

describe('ROLE_OVERRIDABLE_FIELDS', () => {
  it('lists every role field a node can override (FR-017)', () => {
    expect(ROLE_OVERRIDABLE_FIELDS).toEqual(['agent', 'model', 'effort', 'systemPrompt', 'skills'])
  })
})

describe('isRoleFieldOverridden', () => {
  it('is false for every field when the node has no overrides', () => {
    const node = agentNode()
    for (const field of ROLE_OVERRIDABLE_FIELDS) {
      expect(isRoleFieldOverridden(node, field)).toBe(false)
    }
  })

  it('is true only for the fields actually set on overrides — shown distinctly from role defaults', () => {
    const node = agentNode({ overrides: { agent: 'codex', systemPrompt: 'Be terse.' } })

    expect(isRoleFieldOverridden(node, 'agent')).toBe(true)
    expect(isRoleFieldOverridden(node, 'systemPrompt')).toBe(true)
    expect(isRoleFieldOverridden(node, 'model')).toBe(false)
    expect(isRoleFieldOverridden(node, 'effort')).toBe(false)
    expect(isRoleFieldOverridden(node, 'skills')).toBe(false)
  })

  it('treats an explicit empty skills override as overridden, not absent', () => {
    const node = agentNode({ overrides: { skills: [] } })
    expect(isRoleFieldOverridden(node, 'skills')).toBe(true)
  })
})

describe('revertRoleField', () => {
  it('restores the role default for a simple field, dropping overrides entirely once empty', () => {
    const node = agentNode({ overrides: { systemPrompt: 'Be terse.' } })
    const reverted = revertRoleField(node, 'systemPrompt')
    expect(reverted.overrides).toBeUndefined()
  })

  it('reverting agent also clears model and effort overrides chosen relative to it', () => {
    const node = agentNode({ overrides: { agent: 'codex', model: 'gpt-5', effort: 'high' } })
    const reverted = revertRoleField(node, 'agent')
    expect(reverted.overrides).toBeUndefined()
  })

  it('reverting model also clears effort but leaves agent untouched', () => {
    const node = agentNode({ overrides: { agent: 'codex', model: 'gpt-5', effort: 'high' } })
    const reverted = revertRoleField(node, 'model')
    expect(reverted.overrides).toEqual({ agent: 'codex' })
  })

  it('reverting effort leaves agent and model untouched', () => {
    const node = agentNode({ overrides: { agent: 'codex', model: 'gpt-5', effort: 'high' } })
    const reverted = revertRoleField(node, 'effort')
    expect(reverted.overrides).toEqual({ agent: 'codex', model: 'gpt-5' })
  })

  it('reverting skills leaves unrelated overrides untouched', () => {
    const node = agentNode({
      overrides: { systemPrompt: 'Be terse.', skills: [] }
    })
    const reverted = revertRoleField(node, 'skills')
    expect(reverted.overrides).toEqual({ systemPrompt: 'Be terse.' })
  })
})

describe('agentLacksWorkspaceSkillSupport (FR-020)', () => {
  it('is false for an agent with a documented workspace skill location', () => {
    expect(agentLacksWorkspaceSkillSupport('claude')).toBe(false)
  })

  it('is true for an agent outside the skill install provider registry', () => {
    expect(agentLacksWorkspaceSkillSupport('amp')).toBe(true)
  })

  it('is false when no agent is selected yet — nothing to warn about', () => {
    expect(agentLacksWorkspaceSkillSupport(undefined)).toBe(false)
  })
})
