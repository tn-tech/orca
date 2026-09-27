import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { approvalQuestionSubject } from '../../../shared/workflows/workflow-approval-question-subject'
import { resolveApproval } from './workflow-approval-gates'
import {
  approvalDriver,
  approvalLoopWorkflow,
  approvalNode,
  approvalWorkflow
} from './workflow-approval-test-fixtures'
import { joinDriver } from './workflow-run-controller-join-fixtures'
import { createControllerHarness } from './workflow-run-controller-test-harness'

describe('Approval nodes', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof approvalDriver>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-approval-gates-'))
    h = createControllerHarness(workspaceRoot)
    d = approvalDriver(h)
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    h.db.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  const answer = (runId: string, optionId: string, questionId = d.question(runId)?.id ?? '') =>
    resolveApproval(h.db, h.runtime, { runId, questionId, optionId, answeredBy: 'user_1' })

  it('opens a placeholder Task and gate, and the run waits while other branches keep running', async () => {
    const run = h.createRun(approvalWorkflow())
    const finished = h.createController(run.id).run()
    const gate = await d.reached(run.id, 'gate', 'waiting')
    await d.reached(run.id, 'side', 'running')

    expect(gate.taskId).toBeDefined()
    expect(h.db.getTask(gate.taskId ?? '')?.status).toBe('blocked')
    const [decisionGate] = h.db.listGates({ taskId: gate.taskId })
    expect(decisionGate).toMatchObject({
      status: 'pending',
      question: 'Approve the plan?',
      options: JSON.stringify(['approve', 'reject'])
    })
    const question = d.question(run.id)
    expect(question).toMatchObject({
      kind: 'approval',
      gateId: decisionGate?.id,
      prompt: 'Approve the plan?',
      state: 'pending'
    })
    expect(question && approvalQuestionSubject(question)).toEqual({
      options: ['approve', 'reject']
    })
    expect(question?.escalationAt).toBeDefined()
    expect(question?.timeoutAt).toBeDefined()
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('waiting')
    // No downstream node starts while the approval is pending (spec US5 AS1).
    expect(d.attempt(run.id, 'a')).toBeUndefined()
    expect(d.attempt(run.id, 'b')).toBeUndefined()

    answer(run.id, 'approve')
    await d.reached(run.id, 'a', 'running')
    expect(h.db.getGate(decisionGate?.id ?? '')).toMatchObject({
      status: 'resolved',
      resolution: 'approve'
    })
    expect(h.db.getTask(gate.taskId ?? '')?.status).toBe('completed')
    expect(d.attempt(run.id, 'gate')).toMatchObject({
      state: 'completed',
      resultJson: { option: 'approve' }
    })
    expect(d.attempt(run.id, 'b')?.state).toBe('skipped')
    expect(d.question(run.id)).toMatchObject({ state: 'answered', answeredBy: 'user_1' })
    expect(d.question(run.id)?.answeredAt).toBeDefined()
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('running')

    await d.report(run.id, 'a')
    await d.report(run.id, 'side')
    await expect(finished).resolves.toBe('completed')
    expect(d.eventKinds(run.id)).toEqual(
      expect.arrayContaining(['approval_raised', 'run_waiting', 'approval_answered', 'run_resumed'])
    )
  })

  it('routes a rejection along the rejection edge', async () => {
    const run = h.createRun(approvalWorkflow())
    const finished = h.createController(run.id).run()
    await d.reached(run.id, 'gate', 'waiting')
    answer(run.id, 'reject')
    await d.report(run.id, 'b')
    await d.report(run.id, 'side')
    await expect(finished).resolves.toBe('completed')
    expect(d.attempt(run.id, 'gate')?.resultJson).toEqual({ option: 'reject' })
    expect(d.attempt(run.id, 'a')?.state).toBe('skipped')
  })

  it('stops the whole run when the chosen option has no outgoing edge', async () => {
    const run = h.createRun(approvalWorkflow(approvalNode(), { withRejectEdge: false }))
    const stops = joinDriver(h).interceptWorkerStop(() => ({ state: 'stopped' }))
    const finished = h.createController(run.id).run()
    await d.reached(run.id, 'gate', 'waiting')
    const side = await d.reached(run.id, 'side', 'running')
    answer(run.id, 'reject')
    await expect(finished).resolves.toBe('failed')
    expect(d.attempt(run.id, 'gate')).toMatchObject({
      state: 'completed',
      resultJson: { option: 'reject' }
    })
    // The side branch would otherwise reach End; it is asked to stop instead.
    expect(stops).toEqual([side.dispatchId])
    expect(d.attempt(run.id, 'side')?.state).toBe('cancelled')
    expect(d.attempt(run.id, 'end')).toBeUndefined()
    const failed = h.db.listWorkflowEvents(run.id).find((event) => event.kind === 'run_failed')
    expect(failed?.payloadJson).toMatchObject({ reason: 'approval_rejected', nodeId: 'gate' })
  })

  it('accepts only the first answer, and only one of the options', async () => {
    const run = h.createRun(approvalWorkflow())
    const controller = h.createController(run.id)
    const finished = controller.run()
    await d.reached(run.id, 'gate', 'waiting')
    expect(() => answer(run.id, 'maybe')).toThrow(
      expect.objectContaining({ code: 'invalid_argument' })
    )
    expect(() => answer(run.id, 'approve', 'wfq_missing')).toThrow(
      expect.objectContaining({ code: 'workflow_question_not_pending' })
    )
    answer(run.id, 'approve')
    expect(() => answer(run.id, 'reject')).toThrow(
      expect.objectContaining({ code: 'workflow_question_not_pending' })
    )
    await d.reached(run.id, 'a', 'running')
    expect(d.attempt(run.id, 'gate')?.resultJson).toEqual({ option: 'approve' })
    controller.stop()
    await finished
  })

  it('asks again on every Loop iteration', async () => {
    const run = h.createRun(approvalLoopWorkflow())
    const finished = h.createController(run.id).run()

    await d.report(run.id, 'work')
    await d.reached(run.id, 'check', 'waiting')
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('waiting')
    answer(run.id, 'redo', d.question(run.id, 'check')?.id)
    await d.report(run.id, 'record', { go: false })

    await d.report(run.id, 'work', {}, 1)
    await d.reached(run.id, 'check', 'waiting', 1)
    const second = d.question(run.id, 'check', 1)
    expect(second).toMatchObject({ state: 'pending' })
    expect(second?.id).not.toBe(d.question(run.id, 'check')?.id)
    answer(run.id, 'ok', second?.id)
    await d.report(run.id, 'record', { go: true }, 1)

    await expect(finished).resolves.toBe('completed')
    expect(d.attempt(run.id, 'check')?.resultJson).toEqual({ option: 'redo' })
    expect(d.attempt(run.id, 'check', 1)?.resultJson).toEqual({ option: 'ok' })
    const approvals = h.db.listWorkflowQuestions(run.id).filter((q) => q.kind === 'approval')
    expect(approvals.map((q) => [q.state, q.answer])).toEqual([
      ['answered', 'redo'],
      ['answered', 'ok']
    ])
  })
})
