import { describe, expect, it } from 'vitest'
import {
  agentSupportsModelCatalog,
  getAgentCatalogModels,
  getModelEffortChoices
} from './workflow-agent-model-catalog'

describe('workflow-agent-model-catalog', () => {
  it('matches the same predicate workflow-node-dispatch.ts uses on the host (FR-004)', () => {
    expect(agentSupportsModelCatalog('claude')).toBe(true)
    expect(agentSupportsModelCatalog('aider')).toBe(false)
    expect(agentSupportsModelCatalog('not-a-real-agent')).toBe(false)
  })

  it('returns no models for an agent without a launch-preference catalog', () => {
    expect(getAgentCatalogModels('aider')).toEqual([])
  })

  it('returns catalog models for an agent that supports launch preferences', () => {
    const models = getAgentCatalogModels('claude')
    expect(models.some((model) => model.id === 'fable')).toBe(true)
  })

  it('returns effort choices for a model that has an effort option', () => {
    const choices = getModelEffortChoices('claude', 'fable')
    expect(choices.some((choice) => choice.value === 'high')).toBe(true)
  })

  it('returns no effort choices without a chosen model, or for an unknown model', () => {
    expect(getModelEffortChoices('claude', undefined)).toEqual([])
    expect(getModelEffortChoices('claude', 'not-a-real-model')).toEqual([])
    expect(getModelEffortChoices('aider', 'anything')).toEqual([])
  })
})
