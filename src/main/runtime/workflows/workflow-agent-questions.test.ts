import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_ASK_DEFAULT_TIMEOUT_MS } from '../../../shared/orchestration-ask-timeout'
import type { AgentNode, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { RunQuestionView } from '../../../shared/workflows/workflow-run-types'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { AGENT_QUESTION_TIMED_OUT_REASON, answerAgentQuestion } from './workflow-agent-questions'
import { readPath } from './workflow-follow-up-interrupt'
import {
  AGENT_QUESTION_ASK_WAIT_MARGIN_MS,
  agentQuestionDeadlines
} from './workflow-agent-question-ask-wait'
import { approvalDriver } from './workflow-approval-test-fixtures'
import { branchAgent, fanOutWorkflow, joinDriver } from './workflow-run-controller-join-fixtures'
import { WorkflowRunRecorder } from './workflow-run-recorder'
import {
  createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

const TIMEOUT_MS = 60_000
const GRACE_MS = 30_000

function asker(question: AgentNode['question']): AgentNode {
  const node = branchAgent('work')
  if (node.type !== 'agent') {
    throw new Error('branchAgent must build an agent node')
  }
  return { ...node, question }
}

/** start -> work -> end and start -> side -> end: side keeps running while work waits. */
function questionWorkflow(
  question: AgentNode['question'] = { timeoutMs: TIMEOUT_MS, escalationGraceMs: GRACE_MS }
): Workflow {
  return {
    ...TWO_NODE_WORKFLOW,
    name: 'agent-question',
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      asker(question),
      branchAgent('side'),
      { id: 'end', type: 'end', title: 'Done' }
    ],
    edges: [
      { id: 'start-work', from: 'start', to: 'work' },
      { id: 'work-end', from: 'work', to: 'end' },
      { id: 'start-side', from: 'start', to: 'side' },
      { id: 'side-end', from: 'side', to: 'end' }
    ]
  }
}

describe('agent questions during a run', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof approvalDriver>
  let raised: RunQuestionView[]
  let escalated: RunQuestionView[]

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-agent-questions-'))
    h = createControllerHarness(workspaceRoot)
    d = approvalDriver(h)
    raised = []
    escalated = []
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

  function controllerFor(runId: string) {
    return h.createController(runId, {
      onAgentQuestionRaised: (question) => raised.push(question),
      onAgentQuestionEscalated: (question) => escalated.push(question)
    })
  }

  function start(workflow: Workflow = questionWorkflow()) {
    const run = h.createRun(workflow)
    const controller = controllerFor(run.id)
    return { run, controller, finished: controller.run() }
  }

  function workerHandle(runId: string, nodeId: string): string {
    const dispatchId = d.attempt(runId, nodeId)?.dispatchId
    const handle = dispatchId ? h.db.getWorkerDispatch(dispatchId)?.agent_terminal_handle : null
    if (!handle) {
      throw new Error(`${nodeId} has no worker`)
    }
    return handle
  }

  function agentQuestion(runId: string): RunQuestionView | undefined {
    return h.db.listWorkflowQuestions(runId).find((q) => q.kind === 'agent-question')
  }

  /** Resolves once the question is raised; `reply` is the worker's still-blocked ask call. */
  async function ask(
    runId: string,
    options: { question?: string; nodeId?: string; timeoutMs?: number } = {}
  ) {
    const nodeId = options.nodeId ?? 'work'
    await d.reached(runId, nodeId, 'running')
    const reply = h.askQuestion({
      handle: workerHandle(runId, nodeId),
      question: options.question ?? 'Which database should I use?',
      options: 'postgres,sqlite',
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    })
    await d.reached(runId, nodeId, 'waiting')
    return { reply }
  }

  /** A worker stop the host proved: the dispatch settles, leaving its Task blocked. */
  function interceptConfirmedStop() {
    return joinDriver(h).interceptWorkerStop((dispatchId) => {
      const id = String(dispatchId)
      h.db.beginWorkerStop(id, 'runtime_test')
      h.db.settleWorkerStop(id)
      return { state: 'stopped' }
    })
  }

  function events(runId: string, kind: string) {
    return h.db.listWorkflowEvents(runId).filter((event) => event.kind === kind)
  }

  function answer(runId: string, text = 'postgres', answeredBy = 'user_1'): RunQuestionView {
    return answerAgentQuestion(h.db, h.runtime, {
      runId,
      questionId: agentQuestion(runId)?.id ?? '',
      answer: text,
      answeredBy
    })
  }

  it('moves the asking attempt to waiting and publishes the question; other nodes continue', async () => {
    const { run, controller, finished } = start()
    await ask(run.id)

    const question = agentQuestion(run.id)
    expect(question).toMatchObject({
      kind: 'agent-question',
      state: 'pending',
      prompt: 'Which database should I use?',
      attemptId: d.attempt(run.id, 'work')?.id
    })
    expect(question?.questionMessageId).toBeDefined()
    expect(question?.optionsJson).toMatchObject({ options: ['postgres', 'sqlite'] })
    expect(typeof readPath(question?.optionsJson, ['context'])).toBe('string')
    expect(raised.map((q) => q.id)).toEqual([question?.id])
    expect(h.notifyWorkflowRunChanged).toHaveBeenCalledWith({ runId: run.id, reason: 'question' })
    expect(d.eventKinds(run.id)).toContain('agent_question_raised')
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('waiting')
    // The question message was consumed, not merely logged.
    expect(d.eventKinds(run.id)).not.toContain('mailbox_message_deferred')
    expect(d.eventKinds(run.id)).not.toContain('mailbox_message_ignored')

    await d.report(run.id, 'side')
    await d.reached(run.id, 'side', 'completed')
    expect(d.attempt(run.id, 'work')?.state).toBe('waiting')
    controller.stop()
    await finished
  })

  it('delivers the first answer to the agent with the engine consumer generation', async () => {
    const { run, finished } = start()
    const { reply } = await ask(run.id)
    const answerQuestion = vi.spyOn(h.db, 'answerQuestion')
    const notifyMessageArrived = vi.spyOn(h.runtime, 'notifyMessageArrived')
    const dispatchId = d.attempt(run.id, 'work')?.dispatchId

    const answered = answer(run.id)
    expect(answered).toMatchObject({ state: 'answered', answer: 'postgres', answeredBy: 'user_1' })
    expect(() => answer(run.id, 'sqlite', 'user_2')).toThrow(OrchestrationError)

    await d.reached(run.id, 'work', 'running')
    const engineRun = h.db.getRunForWorkflowRun(run.id)
    expect(answerQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: answered.questionMessageId,
        runId: engineRun?.id,
        consumerGeneration: engineRun?.consumer_generation,
        body: 'postgres'
      })
    )
    expect(notifyMessageArrived).toHaveBeenCalledWith(`dispatch:${dispatchId}`, 'status')
    const response = await reply
    expect(response.ok && response.result).toMatchObject({ answer: 'postgres', timedOut: false })
    expect(agentQuestion(run.id)).toMatchObject({ answer: 'postgres', answeredBy: 'user_1' })
    expect(agentQuestion(run.id)?.answeredAt).toBeDefined()

    await d.report(run.id, 'work')
    await d.report(run.id, 'side')
    await expect(finished).resolves.toBe('completed')
  })

  it('escalates at the timeout, then stops the worker and fails the node after the grace', async () => {
    const stops = interceptConfirmedStop()
    const { run, finished } = start()
    await ask(run.id)
    const dispatchId = d.attempt(run.id, 'work')?.dispatchId

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(agentQuestion(run.id)?.state).toBe('escalated')
    expect(escalated.map((q) => q.id)).toEqual([agentQuestion(run.id)?.id])
    expect(d.eventKinds(run.id)).toContain('agent_question_escalated')
    expect(d.attempt(run.id, 'work')?.state).toBe('waiting')

    await vi.advanceTimersByTimeAsync(GRACE_MS)
    await d.reached(run.id, 'work', 'failed')
    expect(stops).toEqual([dispatchId])
    expect(d.attempt(run.id, 'work')?.failureReason).toBe(AGENT_QUESTION_TIMED_OUT_REASON)
    expect(h.db.getTask(d.attempt(run.id, 'work')?.taskId ?? '')?.status).toBe('failed')
    expect(agentQuestion(run.id)).toMatchObject({
      state: 'expired',
      prompt: 'Which database should I use?'
    })
    expect(() => answer(run.id)).toThrow(OrchestrationError)

    // The other branch still runs to its own end.
    await d.report(run.id, 'side')
    await finished
    expect(d.attempt(run.id, 'side')?.state).toBe('completed')
    expect(d.attempt(run.id, 'work')?.state).toBe('failed')
    expect(escalated).toHaveLength(1)
  })

  it('does not claim the worker exited when its stop is unconfirmed', async () => {
    joinDriver(h).interceptWorkerStop(() => ({ state: 'unknown', lastError: 'host unreachable' }))
    const { run, controller, finished } = start()
    await ask(run.id)
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + GRACE_MS)
    await d.reached(run.id, 'work', 'failed')
    const kinds = d.eventKinds(run.id)
    expect(kinds).toContain('agent_question_stop_unconfirmed')
    expect(kinds).not.toContain('attempt_cancelled')
    const stopEvent = h.db
      .listWorkflowEvents(run.id)
      .find((event) => event.kind === 'agent_question_stop_unconfirmed')
    expect(stopEvent?.payloadJson).toMatchObject({ state: 'unknown' })
    // The worker may still be running, so its Task is left as orchestration holds it.
    expect(h.db.getTask(d.attempt(run.id, 'work')?.taskId ?? '')?.status).toBe('dispatched')
    expect(JSON.stringify(h.db.listWorkflowEvents(run.id))).not.toContain('exited')
    controller.stop()
    await finished
  })

  it('applies deadlines that came due while no controller was running', async () => {
    const stops = joinDriver(h).interceptWorkerStop(() => ({ state: 'stopped' }))
    const first = start()
    await ask(first.run.id)
    first.controller.stop()
    await expect(first.finished).resolves.toBe('waiting')

    vi.setSystemTime(Date.now() + TIMEOUT_MS + GRACE_MS)
    const second = controllerFor(first.run.id)
    const finished = second.run()
    await d.reached(first.run.id, 'work', 'failed')
    expect(stops).toHaveLength(1)
    const kinds = d.eventKinds(first.run.id)
    expect(kinds.indexOf('agent_question_escalated')).toBeLessThan(
      kinds.indexOf('agent_question_expired')
    )
    expect(escalated).toHaveLength(1)
    second.stop()
    await finished
  })

  it('delivers an answer recorded while no controller was running', async () => {
    const first = start()
    const { reply } = await ask(first.run.id)
    first.controller.stop()
    await first.finished
    answer(first.run.id)

    const finished = controllerFor(first.run.id).run()
    await d.reached(first.run.id, 'work', 'running')
    const response = await reply
    expect(response.ok && response.result).toMatchObject({ answer: 'postgres' })
    await d.report(first.run.id, 'work')
    await d.report(first.run.id, 'side')
    await expect(finished).resolves.toBe('completed')
  })

  it('supersedes the older open question when the agent asks again', async () => {
    const stops = interceptConfirmedStop()
    const { run, controller, finished } = start()
    await ask(run.id)
    const [first] = h.db.listWorkflowQuestions(run.id)
    const second = h.askQuestion({
      handle: workerHandle(run.id, 'work'),
      question: 'And the port?'
    })
    await waitUntil(() => h.db.listWorkflowQuestions(run.id).length === 2)
    const next = h.db.listWorkflowQuestions(run.id)[1]
    expect(next).toMatchObject({
      kind: 'agent-question',
      state: 'pending',
      prompt: 'And the port?'
    })
    expect(h.db.listWorkflowQuestions(run.id)[0]?.state).toBe('expired')
    expect(events(run.id, 'agent_question_expired')[0]?.payloadJson).toEqual({
      questionId: first?.id,
      reason: 'superseded'
    })
    expect(d.attempt(run.id, 'work')?.state).toBe('waiting')
    expect(() =>
      answerAgentQuestion(h.db, h.runtime, {
        runId: run.id,
        questionId: first?.id ?? '',
        answer: 'postgres',
        answeredBy: 'user_1'
      })
    ).toThrow(expect.objectContaining({ code: 'workflow_question_not_pending' }))

    answerAgentQuestion(h.db, h.runtime, {
      runId: run.id,
      questionId: next?.id ?? '',
      answer: '5432',
      answeredBy: 'user_1'
    })
    await d.reached(run.id, 'work', 'running')
    const response = await second
    expect(response.ok && response.result).toMatchObject({ answer: '5432' })
    // The superseded question's deadlines never fail the node.
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + GRACE_MS)
    expect(d.attempt(run.id, 'work')?.state).toBe('running')
    expect(stops).toEqual([])
    controller.stop()
    await finished
  })

  it('fits escalation and grace inside the agent’s own ask wait', async () => {
    const { run, controller, finished } = start()
    const askStartedAt = Date.now()
    await ask(run.id, { timeoutMs: 40_000 })
    const question = agentQuestion(run.id)
    const escalationAt = Date.parse(question?.escalationAt ?? '')
    const timeoutAt = Date.parse(question?.timeoutAt ?? '')
    expect(timeoutAt).toBeLessThanOrEqual(askStartedAt + 40_000 - AGENT_QUESTION_ASK_WAIT_MARGIN_MS)
    expect(escalationAt).toBeGreaterThan(askStartedAt - 1_000)
    expect(escalationAt).toBeLessThan(timeoutAt)
    controller.stop()
    await finished
  })

  it('does not wait on a question whose ask wait ended before the run saw it', async () => {
    const run = h.createRun(questionWorkflow())
    const first = controllerFor(run.id)
    const firstDone = first.run()
    await d.reached(run.id, 'work', 'running')
    first.stop()
    await firstDone
    // Lost contact meanwhile; the ask itself proves the worker is alive.
    h.db.transitionWorkflowAttempt(d.attempt(run.id, 'work')?.id ?? '', 'unverifiable')
    void h.askQuestion({ handle: workerHandle(run.id, 'work'), question: 'Still there?' })
    await waitUntil(() => h.db.getInbox(10).some((message) => message.type === 'question'))
    vi.setSystemTime(Date.now() + ORCHESTRATION_ASK_DEFAULT_TIMEOUT_MS)

    const second = controllerFor(run.id)
    const finished = second.run()
    await waitUntil(() => agentQuestion(run.id)?.state === 'expired')
    expect(events(run.id, 'agent_question_expired')[0]?.payloadJson).toMatchObject({
      reason: 'ask_wait_ended'
    })
    expect(d.attempt(run.id, 'work')?.state).toBe('running')
    expect(raised).toEqual([])
    second.stop()
    await finished
  })

  it('keeps reading mail while an answer cannot be delivered, then retries it', async () => {
    let refuse = true
    const dispatch = h.dispatcher.dispatchAsWorkflowEngine.bind(h.dispatcher)
    vi.spyOn(h.dispatcher, 'dispatchAsWorkflowEngine').mockImplementation(
      async (request, ...rest) =>
        refuse && request.method === 'orchestration.reply'
          ? {
              id: request.id,
              ok: false,
              error: { code: 'legacy_read_only', message: 'refused' },
              _meta: { runtimeId: 'test' }
            }
          : dispatch(request, ...rest)
    )
    const { run, finished } = start()
    const { reply } = await ask(run.id)
    answer(run.id)
    await waitUntil(() => events(run.id, 'agent_question_delivery_failed').length > 0)
    expect(d.attempt(run.id, 'work')?.state).toBe('waiting')

    // Mail still flows: the side branch's report is processed.
    await d.report(run.id, 'side')
    await d.reached(run.id, 'side', 'completed')
    expect(d.attempt(run.id, 'work')?.state).toBe('waiting')

    refuse = false
    await d.reached(run.id, 'work', 'running')
    const response = await reply
    expect(response.ok && response.result).toMatchObject({ answer: 'postgres' })
    expect(events(run.id, 'agent_question_delivered')).toHaveLength(1)
    await d.report(run.id, 'work')
    await expect(finished).resolves.toBe('completed')
  })

  it('stops retrying a refused delivery once its attempt has ended', async () => {
    const replies: string[] = []
    const dispatch = h.dispatcher.dispatchAsWorkflowEngine.bind(h.dispatcher)
    vi.spyOn(h.dispatcher, 'dispatchAsWorkflowEngine').mockImplementation(
      async (request, ...rest) => {
        if (request.method !== 'orchestration.reply') {
          return dispatch(request, ...rest)
        }
        replies.push(request.id)
        return {
          id: request.id,
          ok: false,
          error: { code: 'legacy_read_only', message: 'refused' },
          _meta: { runtimeId: 'test' }
        }
      }
    )
    const { run, controller, finished } = start()
    await ask(run.id)
    answer(run.id)
    await waitUntil(() => events(run.id, 'agent_question_delivery_failed').length > 0)
    // The worker finishes on its own, ending the attempt the answer was for.
    const attempt = d.attempt(run.id, 'work')
    await h.writeResult(attempt?.resultPath ?? '', { summary: 'decided alone' })
    await h.sendWorkerDone({
      handle: workerHandle(run.id, 'work'),
      taskId: attempt?.taskId ?? '',
      dispatchId: attempt?.dispatchId ?? '',
      reportPath: attempt?.resultPath ?? ''
    })
    await d.reached(run.id, 'work', 'completed')

    const passes = vi.spyOn(h.db, 'getOrCreateRunDelivery')
    const repliesBefore = replies.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(replies.length).toBe(repliesBefore)
    expect(passes.mock.calls.length).toBeLessThan(5)
    controller.stop()
    await finished
  })

  it('tells a racing second answerer that the question was already answered', async () => {
    const { run, controller, finished } = start()
    await ask(run.id)
    const questionId = agentQuestion(run.id)?.id ?? ''
    const write = h.db.answerWorkflowQuestion.bind(h.db)
    // Another client's answer lands between this call's read and its write.
    vi.spyOn(h.db, 'answerWorkflowQuestion').mockImplementationOnce((id, text, by) => {
      write(id, 'sqlite', 'user_2')
      return write(id, text, by)
    })
    expect(() => answer(run.id, 'postgres', 'user_1')).toThrow(
      expect.objectContaining({ code: 'workflow_question_not_pending' })
    )
    expect(agentQuestion(run.id)).toMatchObject({ answer: 'sqlite', answeredBy: 'user_2' })
    expect(events(run.id, 'agent_question_answered')).toHaveLength(0)
    expect(questionId).not.toBe('')
    controller.stop()
    await finished
  })

  it('closes the questions of an attempt a failed Join cancels', async () => {
    interceptConfirmedStop()
    const j = joinDriver(h)
    const fanOut = fanOutWorkflow('all', 'fail')
    // The side branch keeps the run going after the Join fails.
    const run = h.createRun({
      ...fanOut,
      nodes: [...fanOut.nodes, branchAgent('side')],
      edges: [
        ...fanOut.edges,
        { id: 'start-side', from: 'start', to: 'side' },
        { id: 'side-end', from: 'side', to: 'end' }
      ]
    })
    const controller = controllerFor(run.id)
    const finished = controller.run()
    await ask(run.id, { nodeId: 'a' })
    const question = agentQuestion(run.id)
    await j.report(run.id, 'b', 'failed')
    await d.reached(run.id, 'a', 'cancelled')
    expect(h.db.getWorkflowRun(run.id)?.state).not.toMatch(/completed|failed|cancelled/)

    expect(agentQuestion(run.id)?.state).toBe('expired')
    expect(events(run.id, 'agent_question_expired')[0]?.payloadJson).toEqual({
      questionId: question?.id,
      reason: 'attempt_cancelled'
    })
    expect(() =>
      answerAgentQuestion(h.db, h.runtime, {
        runId: run.id,
        questionId: question?.id ?? '',
        answer: 'postgres',
        answeredBy: 'user_1'
      })
    ).toThrow(expect.objectContaining({ code: 'workflow_question_not_pending' }))
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(escalated).toEqual([])
    controller.stop()
    await finished
  })

  it('lets a worker that finished without an answer complete its node', async () => {
    const { run, finished } = start()
    await ask(run.id)
    await d.report(run.id, 'side')
    const attempt = d.attempt(run.id, 'work')
    const handle = workerHandle(run.id, 'work')
    await h.writeResult(attempt?.resultPath ?? '', { summary: 'decided alone' })
    await h.sendWorkerDone({
      handle,
      taskId: attempt?.taskId ?? '',
      dispatchId: attempt?.dispatchId ?? '',
      reportPath: attempt?.resultPath ?? ''
    })
    await expect(finished).resolves.toBe('completed')
    expect(d.attempt(run.id, 'work')?.state).toBe('completed')
    expect(agentQuestion(run.id)?.state).toBe('expired')
  })

  it('refuses answers once the run has ended and closes the open question', async () => {
    const { run, controller, finished } = start()
    await ask(run.id)
    controller.stop()
    await finished
    const question = agentQuestion(run.id)
    new WorkflowRunRecorder(h.db, h.runtime, run.id).transitionRun('cancelled', 'run_cancelled')
    expect(h.db.listWorkflowQuestions(run.id).find((q) => q.id === question?.id)?.state).toBe(
      'expired'
    )
    expect(() =>
      answerAgentQuestion(h.db, h.runtime, {
        runId: run.id,
        questionId: question?.id ?? '',
        answer: 'postgres',
        answeredBy: 'user_1'
      })
    ).toThrow(expect.objectContaining({ code: 'workflow_run_not_active' }))
  })

  it('refuses to answer a question that is not an agent question', () => {
    const run = h.createRun(questionWorkflow())
    const approval = h.db.createWorkflowQuestion({
      runId: run.id,
      attemptId: 'wfa_gate',
      kind: 'approval',
      prompt: 'Approve?'
    })
    expect(() =>
      answerAgentQuestion(h.db, h.runtime, {
        runId: run.id,
        questionId: approval.id,
        answer: 'yes',
        answeredBy: 'user_1'
      })
    ).toThrow(expect.objectContaining({ code: 'workflow_question_not_pending' }))
  })

  it('fits the node timing inside the default ask wait when the ask’s own is unknown', () => {
    const raisedAt = 1_000
    const window = ORCHESTRATION_ASK_DEFAULT_TIMEOUT_MS - AGENT_QUESTION_ASK_WAIT_MARGIN_MS
    const long = asker({ timeoutMs: window * 4, escalationGraceMs: window })
    const fitted = agentQuestionDeadlines(raisedAt, long)
    expect(fitted.timeoutAt).toBe(raisedAt + window)
    expect(fitted.escalationAt).toBe(raisedAt + (window * 4) / 5)

    const short = asker({ timeoutMs: TIMEOUT_MS, escalationGraceMs: GRACE_MS })
    expect(agentQuestionDeadlines(raisedAt, short)).toEqual({
      escalationAt: raisedAt + TIMEOUT_MS,
      timeoutAt: raisedAt + TIMEOUT_MS + GRACE_MS
    })
  })
})
