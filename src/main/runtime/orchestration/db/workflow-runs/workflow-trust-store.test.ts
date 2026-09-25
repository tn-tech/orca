import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

describe('workflow-trust-store', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => db?.close())

  function createDb(): OrchestrationDb {
    db = new OrchestrationDb(':memory:')
    return db
  }

  it('returns undefined for a source with no decision', () => {
    const d = createDb()
    expect(d.getSourceTrust('github.com/acme/skills')).toBeUndefined()
  })

  it('sets and reads back a trust decision', () => {
    const d = createDb()
    const decision = d.setSourceTrust('github.com/acme/skills', 'trusted', 'user_1')
    expect(decision.source).toBe('github.com/acme/skills')
    expect(decision.decision).toBe('trusted')
    expect(decision.decidedBy).toBe('user_1')
    expect(decision.decidedAt).toBeDefined()

    expect(d.getSourceTrust('github.com/acme/skills')).toEqual(decision)
  })

  it('overwrites a prior decision for the same source', () => {
    const d = createDb()
    d.setSourceTrust('github.com/acme/skills', 'trusted', 'user_1')
    const refused = d.setSourceTrust('github.com/acme/skills', 'refused', 'user_2')
    expect(refused.decision).toBe('refused')
    expect(refused.decidedBy).toBe('user_2')
    expect(d.listSourceTrust()).toHaveLength(1)
  })

  it('lists all trust decisions', () => {
    const d = createDb()
    d.setSourceTrust('source-a', 'trusted', 'user_1')
    d.setSourceTrust('source-b', 'refused', 'user_2')
    expect(
      d
        .listSourceTrust()
        .map((row) => row.source)
        .sort()
    ).toEqual(['source-a', 'source-b'])
  })
})
