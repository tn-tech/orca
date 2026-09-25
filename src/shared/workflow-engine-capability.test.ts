import { describe, expect, it } from 'vitest'
import { RUNTIME_CAPABILITIES, WORKFLOW_ENGINE_RUNTIME_CAPABILITY } from './protocol-version'

describe('workflow engine capability', () => {
  it('advertises the visual DAG workflow engine', () => {
    expect(WORKFLOW_ENGINE_RUNTIME_CAPABILITY).toBe('workflow.engine.v1')
    expect(RUNTIME_CAPABILITIES).toContain(WORKFLOW_ENGINE_RUNTIME_CAPABILITY)
  })
})
