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
})

describe('attemptReasonClassName', () => {
  it('is destructive only for a failed attempt', () => {
    expect(attemptReasonClassName('failed')).toBe('text-destructive')
    expect(attemptReasonClassName('cancelled')).toBe('text-muted-foreground')
  })
})
