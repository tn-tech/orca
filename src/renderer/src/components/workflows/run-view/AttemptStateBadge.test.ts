import { describe, expect, it } from 'vitest'
import { attemptReasonClassName, attemptReasonLabel } from './AttemptStateBadge'

describe('attemptReasonLabel', () => {
  it('maps join_skipped to a readable sentence (not the raw machine code)', () => {
    expect(attemptReasonLabel('join_skipped')).toBe('Every branch was skipped.')
  })

  it('maps approval_timed_out to a readable sentence (workflow-approval-deadlines.ts)', () => {
    expect(attemptReasonLabel('approval_timed_out')).toBe('The approval timed out with no answer.')
  })

  it('maps approval_rejected to a readable sentence (workflow-approval-rejection.ts)', () => {
    expect(attemptReasonLabel('approval_rejected')).toBe(
      'The approval was answered with an option that stops the run.'
    )
  })

  it('passes any other failureReason through unchanged (already free text from the engine)', () => {
    expect(attemptReasonLabel('agent crashed')).toBe('agent crashed')
  })

  // F2 (moved to F5): a known failureCode maps to translated copy regardless of the raw
  // failureReason text the host sent (older hosts and newer hosts can word it differently).
  it('maps the agent_readiness_timeout failureCode to translated copy', () => {
    expect(attemptReasonLabel('timeout', 'agent_readiness_timeout')).toBe(
      'The agent never became ready. It may be waiting on a prompt in its terminal, such as a ' +
        'question about trusting the folder. Open the transcript to see it.'
    )
  })

  it('falls back to the failureReason text for an unknown failureCode', () => {
    expect(attemptReasonLabel('agent crashed', 'some_future_code')).toBe('agent crashed')
  })

  it('falls back to the failureReason text when failureCode is absent', () => {
    expect(attemptReasonLabel('join_skipped', undefined)).toBe('Every branch was skipped.')
  })
})

describe('attemptReasonClassName', () => {
  it('is destructive only for a failed attempt', () => {
    expect(attemptReasonClassName('failed')).toBe('text-destructive')
    expect(attemptReasonClassName('cancelled')).toBe('text-muted-foreground')
  })
})
