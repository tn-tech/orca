import { isMobileMethodUnavailableError } from '../files/file-list-fallback'
import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'
import type { RpcOperationSender } from '../transport/rpc-operation-sender'
import { interpretOrThrowRefusalMessage } from '../transport/rpc-refusal-message'
import type { RpcResponse } from '../transport/types'
import {
  workflowRunAnswerSchema,
  workflowRunListSchema,
  workflowRunShowSchema,
  type MobileWorkflowQuestion,
  type MobileWorkflowRunSummary
} from './workflow-run-reply-schema'

const workflowRunListRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'workflow.run-list',
    method: 'workflow.run.list',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('workflow-run-list', workflowRunListSchema)
  })
)

const workflowRunShowRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'workflow.run-show',
    method: 'workflow.run.show',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('workflow-run-show', workflowRunShowSchema)
  })
)

const workflowRunAnswerCall = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'workflow.run-answer',
    method: 'workflow.run.answer',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('workflow-run-answer', workflowRunAnswerSchema)
  })
)

/** Enough recent runs to find the ones waiting on a person without paging on a phone. */
const RUN_LIST_LIMIT = 30
const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'cancelled'])

export type MobileWorkflowRunEntry = {
  run: MobileWorkflowRunSummary
  /** Fetched only for runs that can still ask something; empty for finished runs. */
  questions: MobileWorkflowQuestion[]
}

export type WorkflowRunsLoad =
  | { kind: 'unsupported' }
  | { kind: 'loaded'; runs: MobileWorkflowRunEntry[] }

export type WorkflowQuestionAnswer = { optionId: string } | { answer: string }

export type WorkflowAnswerOutcome =
  | { kind: 'answered' }
  | { kind: 'unsupported' }
  | { kind: 'not-pending' }
  | { kind: 'error'; message: string }

/** R14: a host that predates these methods, or doesn't allowlist them for mobile, has none. */
function isWorkflowRpcUnavailable(reply: RpcResponse): boolean {
  return !reply.ok && isMobileMethodUnavailableError(reply.error.code, reply.error.message)
}

function refusalCode(reply: RpcResponse): string | undefined {
  return reply.ok ? undefined : reply.error.code
}

async function loadRunQuestions(
  client: RpcOperationSender,
  runId: string
): Promise<MobileWorkflowQuestion[]> {
  const reply = await workflowRunShowRead.request(client, { runId })
  // Why: a run removed between list and show just has nothing to ask; keep the rest of the list.
  if (!reply.ok) {
    return []
  }
  return workflowRunShowRead.interpret(reply).questions
}

/** Recent runs with the questions of every run still in flight. Throws the host's message on a
 *  refusal other than "not available", and passes a transport rejection through untouched. */
export async function loadWorkflowRuns(client: RpcOperationSender): Promise<WorkflowRunsLoad> {
  const listReply = await workflowRunListRead.request(client, { limit: RUN_LIST_LIMIT })
  if (isWorkflowRpcUnavailable(listReply)) {
    return { kind: 'unsupported' }
  }
  const { runs } = interpretOrThrowRefusalMessage(
    () => workflowRunListRead.interpret(listReply),
    'Unable to load workflow runs'
  )
  const entries = await Promise.all(
    runs.map(async (run): Promise<MobileWorkflowRunEntry> => {
      const active = run.state === undefined || !TERMINAL_RUN_STATES.has(run.state)
      return { run, questions: active ? await loadRunQuestions(client, run.id) : [] }
    })
  )
  return { kind: 'loaded', runs: entries }
}

/** Answers as this paired device; the host records who answered, so no identity is sent. */
export async function answerWorkflowQuestion(
  client: RpcOperationSender,
  target: { runId: string; questionId: string },
  answer: WorkflowQuestionAnswer
): Promise<WorkflowAnswerOutcome> {
  let reply: RpcResponse
  try {
    reply = await workflowRunAnswerCall.request(client, { ...target, ...answer })
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
  if (isWorkflowRpcUnavailable(reply)) {
    return { kind: 'unsupported' }
  }
  const code = refusalCode(reply)
  if (code === 'workflow_question_not_pending' || code === 'workflow_run_not_active') {
    return { kind: 'not-pending' }
  }
  try {
    interpretOrThrowRefusalMessage(
      () => workflowRunAnswerCall.interpret(reply),
      'Unable to send the answer'
    )
    return { kind: 'answered' }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}
