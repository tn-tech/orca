import { describe, expect, it } from 'vitest'
import type { RunEventView } from './workflow-run-types'
import { questionExpiryReason } from './workflow-question-expiry-reason'

function expiredEvent(patch: Partial<RunEventView> = {}): RunEventView {
  return {
    id: `event-${Math.random()}`,
    runId: 'run-1',
    attemptId: 'attempt-1',
    kind: 'approval_expired',
    payloadJson: { questionId: 'question-1' },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch
  }
}

describe('questionExpiryReason', () => {
  it('reads the reason recorded on the matching approval_expired event (workflow-approval-deadlines.ts closeOpenApprovals)', () => {
    const events = [
      expiredEvent({ payloadJson: { questionId: 'question-1', reason: 'run_ended' } })
    ]

    expect(questionExpiryReason(events, 'question-1')).toBe('run_ended')
  })

  it('returns undefined for a genuine timeout with no recorded reason', () => {
    const events = [expiredEvent({ payloadJson: { questionId: 'question-1' } })]

    expect(questionExpiryReason(events, 'question-1')).toBeUndefined()
  })

  it('returns undefined when no expiry event matches this question', () => {
    const events = [
      expiredEvent({ payloadJson: { questionId: 'other-question', reason: 'run_ended' } })
    ]

    expect(questionExpiryReason(events, 'question-1')).toBeUndefined()
  })

  it.each([
    'run_ended',
    'attempt_cancelled',
    'attempt_failed',
    'attempt_completed',
    'attempt_skipped',
    'superseded',
    'ask_wait_ended',
    'worker_finished'
  ])('reads an agent question closed as %s', (reason) => {
    const events = [
      expiredEvent({
        kind: 'agent_question_expired',
        payloadJson: { questionId: 'question-1', reason }
      })
    ]

    expect(questionExpiryReason(events, 'question-1')).toBe(reason)
  })

  it('returns undefined for an agent question that timed out on its deadline', () => {
    const events = [
      expiredEvent({ kind: 'agent_question_expired', payloadJson: { questionId: 'question-1' } })
    ]

    expect(questionExpiryReason(events, 'question-1')).toBeUndefined()
  })

  it('ignores other event kinds that name the question', () => {
    const events = [
      expiredEvent({
        kind: 'agent_question_answered',
        payloadJson: { questionId: 'question-1', reason: 'x' }
      })
    ]

    expect(questionExpiryReason(events, 'question-1')).toBeUndefined()
  })
})
