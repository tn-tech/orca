import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../orchestration/db'
import { TWO_NODE_WORKFLOW } from './workflow-run-controller-test-harness'
import {
  decideSourceTrust,
  listSourceTrustDecisions,
  raiseTrustQuestion,
  sourceTrustGate,
  trustQuestionSubject,
  workflowTrustHostKey
} from './workflow-source-trust'

const subject = (host: string, source = 'acme-decks') => ({
  source,
  host,
  skills: ['deck-writer'],
  agents: ['claude']
})

describe('workflowTrustHostKey', () => {
  it('names the host that executes the run workspace', () => {
    expect(
      workflowTrustHostKey({ workspaceRoot: '/repo', orcaIgnoreTarget: { host: 'local' } })
    ).toBe('local')
    expect(
      workflowTrustHostKey({
        workspaceRoot: '/home/dev/repo',
        orcaIgnoreTarget: { host: 'remote', connectionId: 'devbox' }
      })
    ).toBe('ssh:devbox')
    expect(
      workflowTrustHostKey({
        workspaceRoot: '\\\\wsl.localhost\\Ubuntu\\home\\dev\\repo',
        orcaIgnoreTarget: { host: 'local' }
      })
    ).toBe('wsl:Ubuntu')
  })
})

describe('source trust store (FR-018a)', () => {
  let db: OrchestrationDb
  const notifier = { notifyWorkflowRunChanged: vi.fn() }

  function createRun() {
    return db.createWorkflowRun({
      workflowName: TWO_NODE_WORKFLOW.name,
      workflowSource: 'project',
      workflowSnapshot: TWO_NODE_WORKFLOW,
      workflowVersion: 'v1',
      objective: 'x',
      repoId: 'repo',
      worktreeId: 'repo::run'
    })
  }

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    notifier.notifyWorkflowRunChanged.mockClear()
  })

  afterEach(() => db.close())

  it('remembers a decision per source per host', async () => {
    const local = sourceTrustGate(db, 'local')
    const ssh = sourceTrustGate(db, 'ssh:devbox')
    expect(await local.decide({ source: 'acme-decks' })).toBe('needs-question')

    decideSourceTrust(db, notifier, {
      host: 'local',
      source: 'acme-decks',
      decision: 'trusted',
      decidedBy: 'client-1'
    })

    expect(await local.decide({ source: 'acme-decks' })).toBe('trusted')
    expect(await ssh.decide({ source: 'acme-decks' })).toBe('needs-question')
    expect(await local.decide({ source: 'other' })).toBe('needs-question')
  })

  it('lists decisions with their host, and a later decision revokes an earlier one', () => {
    const decide = (host: string, decision: 'trusted' | 'refused') =>
      decideSourceTrust(db, notifier, { host, source: 'acme-decks', decision, decidedBy: 'me' })
    decide('local', 'trusted')
    decide('ssh:devbox', 'trusted')
    decide('ssh:devbox', 'refused')

    const decisions = listSourceTrustDecisions(db)
    expect(decisions.map(({ host, source, decision }) => ({ host, source, decision }))).toEqual(
      expect.arrayContaining([
        { host: 'local', source: 'acme-decks', decision: 'trusted' },
        { host: 'ssh:devbox', source: 'acme-decks', decision: 'refused' }
      ])
    )
    expect(decisions).toHaveLength(2)
  })

  it('asks once per attempt and source, and exposes what the question is about', () => {
    const run = createRun()
    const first = raiseTrustQuestion(db, {
      runId: run.id,
      attemptId: 'wfa_1',
      question: subject('local')
    })
    const again = raiseTrustQuestion(db, {
      runId: run.id,
      attemptId: 'wfa_1',
      question: subject('local')
    })

    expect(again.id).toBe(first.id)
    expect(first).toMatchObject({ kind: 'trust', state: 'pending' })
    expect(first.prompt).toContain('acme-decks')
    expect(trustQuestionSubject(first)).toEqual(subject('local'))
  })

  it('answers only the pending questions for that source on that host', () => {
    const runA = createRun()
    const runB = createRun()
    const localA = raiseTrustQuestion(db, {
      runId: runA.id,
      attemptId: 'a1',
      question: subject('local')
    })
    const localB = raiseTrustQuestion(db, {
      runId: runB.id,
      attemptId: 'b1',
      question: subject('local')
    })
    const sshB = raiseTrustQuestion(db, {
      runId: runB.id,
      attemptId: 'b2',
      question: subject('ssh:devbox')
    })
    const otherSource = raiseTrustQuestion(db, {
      runId: runB.id,
      attemptId: 'b3',
      question: subject('local', 'other')
    })

    const runIds = decideSourceTrust(db, notifier, {
      host: 'local',
      source: 'acme-decks',
      decision: 'refused',
      decidedBy: 'me'
    })

    expect(new Set(runIds)).toEqual(new Set([runA.id, runB.id]))
    const state = (id: string, runId: string) =>
      db.listWorkflowQuestions(runId).find((q) => q.id === id)
    expect(state(localA.id, runA.id)).toMatchObject({ state: 'answered', answer: 'refused' })
    expect(state(localB.id, runB.id)).toMatchObject({ state: 'answered', answer: 'refused' })
    expect(state(sshB.id, runB.id)?.state).toBe('pending')
    expect(state(otherSource.id, runB.id)?.state).toBe('pending')
    expect(notifier.notifyWorkflowRunChanged).toHaveBeenCalledWith({
      runId: runA.id,
      reason: 'question'
    })
  })
})
