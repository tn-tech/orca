import { describe, expect, it } from 'vitest'
import { canTransition, WORKFLOW_ATTEMPT_STATES, WORKFLOW_RUN_STATES } from './workflow-node-states'

describe('WORKFLOW_RUN_STATES / WORKFLOW_ATTEMPT_STATES', () => {
  it('lists the states from data-model.md section 3', () => {
    expect(WORKFLOW_RUN_STATES).toEqual([
      'queued',
      'running',
      'paused',
      'waiting',
      'completed',
      'failed',
      'cancelled'
    ])
    expect(WORKFLOW_ATTEMPT_STATES).toEqual([
      'pending',
      'provisioning',
      'running',
      'waiting',
      'completed',
      'failed',
      'skipped',
      'cancelled',
      'unverifiable'
    ])
  })
})

describe('canTransition — run', () => {
  it('queued -> running, cancelled, or failed', () => {
    expect(canTransition('run', 'queued', 'running')).toBe(true)
    expect(canTransition('run', 'queued', 'cancelled')).toBe(true)
    expect(canTransition('run', 'queued', 'failed')).toBe(true)
    expect(canTransition('run', 'queued', 'waiting')).toBe(false)
  })

  it('running <-> paused', () => {
    expect(canTransition('run', 'running', 'paused')).toBe(true)
    expect(canTransition('run', 'paused', 'running')).toBe(true)
  })

  it('running -> waiting -> running', () => {
    expect(canTransition('run', 'running', 'waiting')).toBe(true)
    expect(canTransition('run', 'waiting', 'running')).toBe(true)
  })

  it('running|waiting -> completed|failed|cancelled', () => {
    for (const from of ['running', 'waiting'] as const) {
      expect(canTransition('run', from, 'completed')).toBe(true)
      expect(canTransition('run', from, 'failed')).toBe(true)
      expect(canTransition('run', from, 'cancelled')).toBe(true)
    }
  })

  it('waiting <-> paused (FR-030: pause keeps open questions answerable)', () => {
    expect(canTransition('run', 'waiting', 'paused')).toBe(true)
    expect(canTransition('run', 'paused', 'waiting')).toBe(true)
  })

  it('paused -> cancelled (FR-030: cancel any run)', () => {
    expect(canTransition('run', 'paused', 'cancelled')).toBe(true)
  })

  it('paused -> failed (an approval answered while paused can still stop the run)', () => {
    expect(canTransition('run', 'paused', 'failed')).toBe(true)
    expect(canTransition('run', 'paused', 'completed')).toBe(false)
  })

  it('terminal states are final', () => {
    for (const terminal of ['completed', 'failed', 'cancelled'] as const) {
      for (const to of WORKFLOW_RUN_STATES) {
        expect(canTransition('run', terminal, to)).toBe(false)
      }
    }
  })
})

describe('canTransition — attempt', () => {
  it('pending -> provisioning -> running -> completed|failed', () => {
    expect(canTransition('attempt', 'pending', 'provisioning')).toBe(true)
    expect(canTransition('attempt', 'provisioning', 'running')).toBe(true)
    expect(canTransition('attempt', 'running', 'completed')).toBe(true)
    expect(canTransition('attempt', 'running', 'failed')).toBe(true)
  })

  it('running -> waiting -> running', () => {
    expect(canTransition('attempt', 'running', 'waiting')).toBe(true)
    expect(canTransition('attempt', 'waiting', 'running')).toBe(true)
    expect(canTransition('attempt', 'waiting', 'completed')).toBe(false)
  })

  it('pending -> skipped', () => {
    expect(canTransition('attempt', 'pending', 'skipped')).toBe(true)
    expect(canTransition('attempt', 'provisioning', 'skipped')).toBe(false)
  })

  it('provisioning -> failed (US4 AS4: a provisioning failure fails the node before launch)', () => {
    expect(canTransition('attempt', 'provisioning', 'failed')).toBe(true)
  })

  it('provisioning <-> waiting (FR-018a: a trust question pauses provisioning, then resumes)', () => {
    expect(canTransition('attempt', 'provisioning', 'waiting')).toBe(true)
    expect(canTransition('attempt', 'waiting', 'provisioning')).toBe(true)
  })

  it('any non-terminal -> cancelled', () => {
    for (const from of ['pending', 'provisioning', 'running', 'waiting', 'unverifiable'] as const) {
      expect(canTransition('attempt', from, 'cancelled')).toBe(true)
    }
  })

  it('running -> unverifiable -> running|failed (positive proof of exit only)', () => {
    expect(canTransition('attempt', 'running', 'unverifiable')).toBe(true)
    expect(canTransition('attempt', 'unverifiable', 'running')).toBe(true)
    expect(canTransition('attempt', 'unverifiable', 'failed')).toBe(true)
    expect(canTransition('attempt', 'unverifiable', 'completed')).toBe(false)
  })

  it('terminal states are final', () => {
    for (const terminal of ['completed', 'failed', 'skipped', 'cancelled'] as const) {
      for (const to of WORKFLOW_ATTEMPT_STATES) {
        expect(canTransition('attempt', terminal, to)).toBe(false)
      }
    }
  })

  it('rejects an unknown state', () => {
    expect(canTransition('attempt', 'bogus', 'running')).toBe(false)
  })
})
