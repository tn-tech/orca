import type { WorkflowProblem } from '../../shared/workflows/workflow-definition-types'
import type { WorkflowRunState } from '../../shared/workflows/workflow-node-states'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { printResult } from '../format'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { buildCurrentWorktreeSelector } from '../selectors'
import { RuntimeClientError, type RuntimeRpcSuccess } from '../runtime-client'

type WorkflowClient = HandlerContext['client']

// Why: only `workflows list` exposes an explicit --repo (contracts/cli.md); the other
// name-scoped commands default silently to the enclosing worktree's repo.
function resolveWorkflowRepoSelector(flags: Map<string, string | boolean>, cwd: string): string {
  return getOptionalStringFlag(flags, 'repo') ?? buildCurrentWorktreeSelector(cwd)
}

// Why: this unit only wires each command to its RPC method; result formatting is T064's job.
function printRawResult<TResult>(result: RuntimeRpcSuccess<TResult>, json: boolean): void {
  printResult(result, json, (value) => JSON.stringify(value, null, 2))
}

const WORKFLOW_RUN_TERMINAL_STATES = new Set<WorkflowRunState>(['completed', 'failed', 'cancelled'])
const WORKFLOW_STATUS_POLL_INTERVAL_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Polls `workflow.run.show`/`workflow.run.events` (contracts/cli.md `status --wait`) until terminal. */
async function pollWorkflowRunUntilTerminal(
  client: WorkflowClient,
  runId: string
): Promise<RuntimeRpcSuccess<{ state: WorkflowRunState }>> {
  let snapshot = await client.call<{ state: WorkflowRunState }>('workflow.run.show', { runId })
  let afterSeq: number | undefined
  while (!WORKFLOW_RUN_TERMINAL_STATES.has(snapshot.result.state)) {
    const events = await client.call<{ nextSeq: number }>('workflow.run.events', {
      runId,
      afterSeq
    })
    afterSeq = events.result.nextSeq
    await sleep(WORKFLOW_STATUS_POLL_INTERVAL_MS)
    snapshot = await client.call<{ state: WorkflowRunState }>('workflow.run.show', { runId })
  }
  return snapshot
}

export const WORKFLOW_HANDLERS: Record<string, CommandHandler> = {
  'workflows list': async ({ flags, client, cwd, json }) => {
    const result = await client.call('workflow.list', {
      repo: resolveWorkflowRepoSelector(flags, cwd)
    })
    printRawResult(result, json)
  },
  'workflows show': async ({ flags, client, cwd, json }) => {
    const result = await client.call('workflow.read', {
      repo: resolveWorkflowRepoSelector(flags, cwd),
      name: getRequiredStringFlag(flags, 'name')
    })
    printRawResult(result, json)
  },
  'workflows validate': async ({ flags, client, cwd, json }) => {
    const repo = resolveWorkflowRepoSelector(flags, cwd)
    const read = await client.call<{ definition: unknown }>('workflow.read', {
      repo,
      name: getRequiredStringFlag(flags, 'name')
    })
    const result = await client.call<{ problems: WorkflowProblem[] }>('workflow.validate', {
      repo,
      definition: read.result.definition
    })
    printRawResult(result, json)
    if (result.result.problems.some((problem) => problem.severity === 'error')) {
      process.exitCode = 1
    }
  },
  'workflows run': async ({ flags, client, cwd, json }) => {
    const concurrencyLimit = getOptionalPositiveIntegerFlag(flags, 'concurrency')
    const result = await client.call('workflow.run.start', {
      repo: resolveWorkflowRepoSelector(flags, cwd),
      name: getRequiredStringFlag(flags, 'name'),
      objective: getRequiredStringFlag(flags, 'objective'),
      ...(concurrencyLimit ? { overrides: { concurrencyLimit } } : {})
    })
    printRawResult(result, json)
  },
  'workflows runs': async ({ flags, client, json }) => {
    const result = await client.call('workflow.run.list', {
      name: getOptionalStringFlag(flags, 'name'),
      state: getOptionalStringFlag(flags, 'state')
    })
    printRawResult(result, json)
  },
  'workflows status': async ({ flags, client, json }) => {
    const runId = getRequiredStringFlag(flags, 'run-id')
    const result =
      flags.get('wait') === true
        ? await pollWorkflowRunUntilTerminal(client, runId)
        : await client.call('workflow.run.show', { runId })
    printRawResult(result, json)
  },
  'workflows answer': async ({ flags, client, json }) => {
    const optionId = getOptionalStringFlag(flags, 'option')
    const answer = getOptionalStringFlag(flags, 'text')
    if ((optionId ? 1 : 0) + (answer ? 1 : 0) !== 1) {
      throw new RuntimeClientError('invalid_argument', 'Provide exactly one of --option or --text.')
    }
    const result = await client.call('workflow.run.answer', {
      runId: getRequiredStringFlag(flags, 'run-id'),
      questionId: getRequiredStringFlag(flags, 'question-id'),
      ...(optionId ? { optionId } : {}),
      ...(answer ? { answer } : {})
    })
    printRawResult(result, json)
  },
  'workflows send': async ({ flags, client, json }) => {
    const result = await client.call('workflow.run.sendMessage', {
      runId: getRequiredStringFlag(flags, 'run-id'),
      attemptId: getRequiredStringFlag(flags, 'attempt-id'),
      text: getRequiredStringFlag(flags, 'text'),
      mode: flags.get('interrupt') === true ? 'interrupt' : 'queued'
    })
    printRawResult(result, json)
  },
  'workflows pause': async ({ flags, client, json }) => {
    const result = await client.call('workflow.run.pause', {
      runId: getRequiredStringFlag(flags, 'run-id')
    })
    printRawResult(result, json)
  },
  'workflows resume': async ({ flags, client, json }) => {
    const result = await client.call('workflow.run.resume', {
      runId: getRequiredStringFlag(flags, 'run-id')
    })
    printRawResult(result, json)
  },
  'workflows cancel': async ({ flags, client, json }) => {
    const result = await client.call('workflow.run.cancel', {
      runId: getRequiredStringFlag(flags, 'run-id')
    })
    printRawResult(result, json)
  },
  'workflows rerun': async ({ flags, client, json }) => {
    const result = await client.call('workflow.run.rerun', {
      runId: getRequiredStringFlag(flags, 'run-id'),
      fromNodeId: getRequiredStringFlag(flags, 'from')
    })
    printRawResult(result, json)
  },
  'workflows trust': async ({ flags, client, json }) => {
    const result = await client.call('workflow.trust.decide', {
      source: getRequiredStringFlag(flags, 'source'),
      decision: getRequiredStringFlag(flags, 'decision')
    })
    printRawResult(result, json)
  }
}
