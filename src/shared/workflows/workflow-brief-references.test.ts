import { describe, expect, it } from 'vitest'
import type { BriefReferenceInputs } from './workflow-brief-references'
import { resolveBriefReferences } from './workflow-brief-references'

const inputs: BriefReferenceInputs = {
  objective: 'Add CSV export to the reports page',
  upstream: {
    plan: { result: { summary: 'Plan drafted', score: 8 }, artifacts: ['plan.md', 'notes.md'] }
  },
  loopPrevious: {
    review: { result: { approved: false } }
  },
  joinBranches: { plan: 'completed', review: 'failed' }
}

describe('resolveBriefReferences', () => {
  it('resolves ${objective}', () => {
    const { text, problems } = resolveBriefReferences('Objective: ${objective}', inputs)
    expect(text).toBe('Objective: Add CSV export to the reports page')
    expect(problems).toEqual([])
  })

  it('resolves ${upstream.<node>.result.<path>}', () => {
    const { text, problems } = resolveBriefReferences(
      'Summary: ${upstream.plan.result.summary}',
      inputs
    )
    expect(text).toBe('Summary: Plan drafted')
    expect(problems).toEqual([])
  })

  it('resolves a nested ${upstream.<node>.result.<path>}', () => {
    const { text, problems } = resolveBriefReferences(
      'Score: ${upstream.plan.result.score}',
      inputs
    )
    expect(text).toBe('Score: 8')
    expect(problems).toEqual([])
  })

  it('resolves ${upstream.<node>.artifacts}', () => {
    const { text, problems } = resolveBriefReferences(
      'Artifacts: ${upstream.plan.artifacts}',
      inputs
    )
    expect(text).toBe('Artifacts: ["plan.md","notes.md"]')
    expect(problems).toEqual([])
  })

  it('resolves ${loop.previous.<node>.result.<path>}', () => {
    const { text, problems } = resolveBriefReferences(
      'Previously approved: ${loop.previous.review.result.approved}',
      inputs
    )
    expect(text).toBe('Previously approved: false')
    expect(problems).toEqual([])
  })

  it('resolves ${join.branches}', () => {
    const { text, problems } = resolveBriefReferences('Branches: ${join.branches}', inputs)
    expect(text).toBe('Branches: {"plan":"completed","review":"failed"}')
    expect(problems).toEqual([])
  })

  it('resolves multiple references in one text', () => {
    const { text, problems } = resolveBriefReferences(
      '${objective} — from ${upstream.plan.result.summary}',
      inputs
    )
    expect(text).toBe('Add CSV export to the reports page — from Plan drafted')
    expect(problems).toEqual([])
  })

  it('produces a Problem for an unrecognized reference form and leaves the text unresolved', () => {
    const { text, problems } = resolveBriefReferences('Value: ${bogus.thing}', inputs)
    expect(text).toBe('Value: ${bogus.thing}')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ severity: 'error' })
    expect(problems[0].message).toContain('bogus.thing')
  })

  it('produces a Problem when the referenced upstream node is unknown', () => {
    const { text, problems } = resolveBriefReferences('${upstream.missing.result.x}', inputs)
    expect(text).toBe('${upstream.missing.result.x}')
    expect(problems).toHaveLength(1)
  })

  it('produces a Problem when the referenced result path is missing', () => {
    const { text, problems } = resolveBriefReferences('${upstream.plan.result.nope}', inputs)
    expect(text).toBe('${upstream.plan.result.nope}')
    expect(problems).toHaveLength(1)
  })

  it('produces a Problem when loop.previous data is unavailable outside a loop', () => {
    const { text, problems } = resolveBriefReferences('${loop.previous.other.result.x}', inputs)
    expect(text).toBe('${loop.previous.other.result.x}')
    expect(problems).toHaveLength(1)
  })

  it('produces a Problem when join.branches is unavailable outside a join', () => {
    const { text, problems } = resolveBriefReferences('${join.branches}', {
      objective: 'x',
      upstream: {}
    })
    expect(text).toBe('${join.branches}')
    expect(problems).toHaveLength(1)
  })

  it('returns text unchanged and no problems when there are no references', () => {
    const { text, problems } = resolveBriefReferences('No references here.', inputs)
    expect(text).toBe('No references here.')
    expect(problems).toEqual([])
  })
})
