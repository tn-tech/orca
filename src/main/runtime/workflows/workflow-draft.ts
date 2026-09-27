// `workflow.draft` (US6, T115): runs the one-off planner workflow through the engine, then
// validates the definition it produced. The draft is returned, never written as a workflow file;
// it becomes one only when the user saves it (US6 AS2).
import type { Repo } from '../../../shared/repo-types'
import { parseWorkflowDefinition } from '../../../shared/workflows/workflow-definition-schema'
import type { Workflow, WorkflowProblem } from '../../../shared/workflows/workflow-definition-types'
import {
  validateWorkflowGraph,
  type GraphValidationContext
} from '../../../shared/workflows/workflow-graph-validation'
import type { RunSnapshot } from '../../../shared/workflows/workflow-run-types'
import { getSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import {
  buildDraftPlannerWorkflow,
  DRAFT_PLANNER_NODE_ID,
  DRAFT_PLANNER_WORKFLOW_NAME
} from './workflow-draft-planner'
import { plannerRawDraft } from './workflow-draft-result'
import {
  WorkflowGraphValidationError,
  type WorkflowEngine,
  type WorkflowEngineWorktreeCleanup
} from './workflow-engine'
import { WORKFLOW_HOST_UNREACHABLE_CODE } from './workflow-run-workspace'
import { getRepoWorkflowSourceAllowlist } from './workflow-source-allowlist'

const TERMINAL_RUN_STATES = new Set<RunSnapshot['state']>(['completed', 'failed', 'cancelled'])
const DEFAULT_POLL_INTERVAL_MS = 1_000
// Why bounded: a planner parked on an unanswered question must not pin the request forever.
const DEFAULT_TIMEOUT_MS = 15 * 60_000

export type WorkflowDraftDeps = {
  engine: Pick<WorkflowEngine, 'startRun' | 'getSnapshot'>
  db: OrchestrationDb
  worktrees: WorkflowEngineWorktreeCleanup
  validation: Pick<GraphValidationContext, 'agentSupportsModel' | 'isKnownAgent'>
  /** Overridable for tests; production keeps the defaults. */
  pollIntervalMs?: number
  timeoutMs?: number
}

export type WorkflowDraftInput = {
  repo: Repo
  objective: string
  plannerAgent: string
  startedByClient?: string
  signal?: AbortSignal
}

export type WorkflowDraftResult = {
  /** Absent when the planner produced nothing that parses as a workflow definition. */
  definition?: Workflow
  problems: WorkflowProblem[]
  /** Always true: the definition exists only in this result until the user saves it. */
  draft: true
  /** The planner's run, so a client can show its transcript. */
  runId: string
}

function draftProblem(code: string, message: string): WorkflowProblem {
  return { code, message, severity: 'error' }
}

/** US6 AS1: every dispatching node must name a role or an agent. */
function unassignedNodeProblems(definition: Workflow): WorkflowProblem[] {
  return definition.nodes
    .filter((node) => node.type === 'agent' || node.type === 'router' || node.type === 'reflection')
    .filter((node) => node.roleId === undefined && node.overrides?.agent === undefined)
    .map((node) => ({
      code: 'workflow_draft_node_unassigned',
      message: `Node "${node.id}" has neither a role nor an agent.`,
      nodeId: node.id,
      severity: 'error'
    }))
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('request_aborted'))
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('request_aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** `undefined` when the deadline passed first; the run itself is left to finish on its own. */
async function waitForTerminalRun(
  deps: WorkflowDraftDeps,
  runId: string,
  signal: AbortSignal | undefined
): Promise<RunSnapshot | undefined> {
  const deadline = Date.now() + (deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  for (;;) {
    const run = deps.engine.getSnapshot(runId)
    if (run && TERMINAL_RUN_STATES.has(run.state)) {
      return run
    }
    if (Date.now() >= deadline) {
      return undefined
    }
    await sleep(deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, signal)
  }
}

async function startPlannerRun(deps: WorkflowDraftDeps, input: WorkflowDraftInput) {
  try {
    return await deps.engine.startRun({
      workflow: buildDraftPlannerWorkflow(input.repo, input.plannerAgent),
      workflowSource: 'project',
      workflowVersion: DRAFT_PLANNER_WORKFLOW_NAME,
      objective: input.objective,
      repo: input.repo,
      ...(input.startedByClient ? { startedByClient: input.startedByClient } : {}),
      validation: deps.validation
    })
  } catch (error) {
    if (error instanceof WorkflowGraphValidationError) {
      throw new OrchestrationError('workflow_invalid', 'workflow_invalid', {
        problems: error.problems
      })
    }
    throw error
  }
}

async function removeRunWorkspace(
  deps: WorkflowDraftDeps,
  run: RunSnapshot,
  repo: Repo
): Promise<void> {
  // An in-place run records the repo id as its worktree; there is nothing to remove.
  if (!run.worktreeId || run.worktreeId === repo.id) {
    return
  }
  await deps.worktrees.removeManagedWorktree(`id:${run.worktreeId}`).catch((error: unknown) => {
    console.warn(`[workflow-draft] failed to remove planner workspace ${run.worktreeId}:`, error)
  })
}

async function validateDraft(
  raw: unknown,
  repo: Repo,
  validation: WorkflowDraftDeps['validation']
): Promise<Pick<WorkflowDraftResult, 'definition' | 'problems'>> {
  const parsed = parseWorkflowDefinition(raw)
  if (!parsed.definition) {
    return { problems: parsed.problems }
  }
  const graphProblems = validateWorkflowGraph(parsed.definition, {
    ...validation,
    allowlistedSources: await getRepoWorkflowSourceAllowlist(repo)
  })
  return {
    definition: parsed.definition,
    problems: [...parsed.problems, ...graphProblems, ...unassignedNodeProblems(parsed.definition)]
  }
}

export async function draftWorkflow(
  deps: WorkflowDraftDeps,
  input: WorkflowDraftInput
): Promise<WorkflowDraftResult> {
  // SSH repos plan on their own host; there is no local fallback (ssh-execution-boundary.md).
  if (input.repo.connectionId && !getSshFilesystemProvider(input.repo.connectionId)) {
    throw new Error(WORKFLOW_HOST_UNREACHABLE_CODE)
  }
  const started = await startPlannerRun(deps, input)
  const run = await waitForTerminalRun(deps, started.id, input.signal)
  if (!run) {
    return {
      problems: [
        draftProblem(
          'workflow_draft_timeout',
          'The planner did not finish in time; its run keeps going and can be followed there.'
        )
      ],
      draft: true,
      runId: started.id
    }
  }
  const attempt = deps.db
    .listWorkflowAttempts(run.id)
    .findLast((candidate) => candidate.nodeId === DRAFT_PLANNER_NODE_ID)
  const raw = plannerRawDraft(deps.db, run, attempt)
  await removeRunWorkspace(deps, run, input.repo)
  if (!raw.ok) {
    return { problems: [draftProblem(raw.code, raw.message)], draft: true, runId: run.id }
  }
  return {
    ...(await validateDraft(raw.value, input.repo, deps.validation)),
    draft: true,
    runId: run.id
  }
}
