// Rerun a failed run from a node (FR-030, US8 AS2). The rerun is a new run on the source's own
// definition snapshot and run workspace, so the artifacts its retained upstream attempts point
// at are on disk where it runs. Nodes outside the rerun set keep their attempts (copied when the
// controller first starts the rerun); the frontier then launches only the rerun set. A node
// inside a Loop reruns the whole Loop from its first iteration: iteration progress and the
// previous-iteration inputs (FR-028) live on the Loop's own attempts, not on one body node.
import type { Repo } from '../../../shared/repo-types'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../shared/workflows/workflow-node-states'
import type { NodeAttemptView, RunSnapshot } from '../../../shared/workflows/workflow-run-types'
import { getRepoMainWorktreeId } from '../../../shared/worktree/id'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { isDraftPlannerRun } from './workflow-draft-planner'
import { latestAttemptByNode } from './workflow-frontier'
import { containingLoop } from './workflow-join-branch-stop'
import { resolveRunWorkspaceAccess } from './workflow-run-host-access'
import type { WorkflowRunRecorder } from './workflow-run-recorder'
import { assertWorkflowRunnable, type WorkflowRunValidation } from './workflow-run-validation'

const SETTLED_ATTEMPT_STATES: ReadonlySet<WorkflowAttemptState> = new Set(['completed', 'skipped'])
const TERMINAL_ATTEMPT_STATES: ReadonlySet<WorkflowAttemptState> = new Set([
  'completed',
  'skipped',
  'failed',
  'cancelled'
])

export type WorkflowRerunPlan = {
  /** The node the rerun starts from, lifted to its Loop when it sits inside one. */
  fromNodeId?: string
  rerunNodeIds: ReadonlySet<string>
  /** Source attempts retained by the rerun. */
  retained: NodeAttemptView[]
}

function outermostNodeId(definition: Workflow, nodeId: string): string {
  let current = nodeId
  for (
    let loop = containingLoop(definition, current);
    loop;
    loop = containingLoop(definition, current)
  ) {
    current = loop.id
  }
  return current
}

/**
 * The rerun set is the from-node, every top-level node that did not settle (failed, cancelled,
 * never reached), and everything downstream of them. Only settled ancestors or siblings stay.
 */
export function planRerun(
  definition: Workflow,
  attempts: readonly NodeAttemptView[],
  fromNodeId?: string
): WorkflowRerunPlan {
  const latest = latestAttemptByNode(attempts)
  const topLevel = definition.nodes.filter((node) => !containingLoop(definition, node.id))
  const unsettled = topLevel.filter((node) => {
    const state = latest.get(node.id)?.state
    return state === undefined || !SETTLED_ATTEMPT_STATES.has(state)
  })
  const from =
    fromNodeId !== undefined
      ? outermostNodeId(definition, fromNodeId)
      : topLevel.find((node) => latest.get(node.id)?.state === 'failed')?.id
  const rerunNodeIds = new Set<string>()
  const queue = [...(from ? [from] : []), ...unsettled.map((node) => node.id)]
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const nodeId = outermostNodeId(definition, next)
    if (rerunNodeIds.has(nodeId)) {
      continue
    }
    rerunNodeIds.add(nodeId)
    const node = definition.nodes.find((candidate) => candidate.id === nodeId)
    const members = node?.type === 'loop' ? [nodeId, ...node.body.nodeIds] : [nodeId]
    for (const member of members) {
      rerunNodeIds.add(member)
    }
    for (const edge of definition.edges) {
      if (members.includes(edge.from)) {
        queue.push(edge.to)
      }
    }
  }
  const retained = attempts.filter(
    (attempt) => !rerunNodeIds.has(attempt.nodeId) && TERMINAL_ATTEMPT_STATES.has(attempt.state)
  )
  return { ...(from ? { fromNodeId: from } : {}), rerunNodeIds, retained }
}

/**
 * Copies a queued rerun's retained attempts before its first advance. Idempotent: a rerun that
 * already has attempts (a restart after seeding) is left alone.
 */
export function seedRerunAttempts(
  db: OrchestrationDb,
  recorder: WorkflowRunRecorder,
  run: RunSnapshot
): void {
  if (!run.rerunOfRunId || db.listWorkflowAttempts(run.id).length > 0) {
    return
  }
  const plan = planRerun(
    run.workflowSnapshot,
    db.listWorkflowAttempts(run.rerunOfRunId),
    run.rerunFromNodeId
  )
  const copies = db.copyWorkflowAttempts(
    plan.retained.map((attempt) => attempt.id),
    run.id
  )
  copies.forEach((copy, index) => {
    recorder.event(
      'attempt_copied',
      {
        nodeId: copy.nodeId,
        iteration: copy.iteration,
        state: copy.state,
        sourceAttemptId: plan.retained[index].id
      },
      { attemptId: copy.id, reason: 'attempt' }
    )
  })
  recorder.event('rerun_seeded', {
    rerunOfRunId: run.rerunOfRunId,
    fromNodeId: plan.fromNodeId ?? null,
    rerunNodeIds: [...plan.rerunNodeIds]
  })
}

export type WorkflowRerunDeps = {
  db: OrchestrationDb
  /** `WorkflowEngine.launch`. */
  launch(run: RunSnapshot): void
  resolveRepo(repoId: string): Promise<Repo>
  showManagedWorktree(selector: string): Promise<{ id: string; path: string }>
  validation: WorkflowRunValidation
}

function refuse(message: string, runId: string): never {
  throw new OrchestrationError('workflow_rerun_refused', message, { runId })
}

/** Two live runs in one run workspace would edit the same files; in-place runs share by design. */
function refuseBusyWorkspace(db: OrchestrationDb, source: RunSnapshot): void {
  if (source.workflowSnapshot.workspacePolicy !== 'run-workspace') {
    return
  }
  const busy = db.listActiveWorkflowRuns().find((run) => run.worktreeId === source.worktreeId)
  if (busy) {
    refuse(`Run ${busy.id} is still active in this run's workspace.`, source.id)
  }
}

export async function startRerun(
  deps: WorkflowRerunDeps,
  args: { runId: string; fromNodeId?: string; startedByClient?: string }
): Promise<RunSnapshot> {
  const { db } = deps
  const source = db.getWorkflowRun(args.runId)
  if (!source) {
    throw new Error('workflow_not_found')
  }
  // Planner runs are throwaway and torn down; their marker must never reach a user's run.
  if (isDraftPlannerRun(source)) {
    refuse(`Run ${source.id} is a workflow draft planner run and cannot be rerun.`, source.id)
  }
  if (source.state !== 'failed') {
    refuse(`Only a failed run can be rerun; run ${source.id} is ${source.state}.`, source.id)
  }
  const definition = source.workflowSnapshot
  if (args.fromNodeId && !definition.nodes.some((node) => node.id === args.fromNodeId)) {
    refuse(`Run ${source.id} has no node ${args.fromNodeId}.`, source.id)
  }
  refuseBusyWorkspace(db, source)
  const repo = await deps.resolveRepo(source.repoId)
  await assertWorkflowRunnable(definition, repo, deps.validation)
  try {
    await resolveRunWorkspaceAccess(source, repo, deps.showManagedWorktree)
  } catch (error) {
    throw new OrchestrationError(
      'workflow_rerun_workspace_unavailable',
      `Run ${source.id}'s workspace is not available: ${error instanceof Error ? error.message : String(error)}`,
      { runId: source.id }
    )
  }
  const { fromNodeId } = planRerun(definition, db.listWorkflowAttempts(source.id), args.fromNodeId)
  const rerun = db.createWorkflowRun({
    workflowName: source.workflowName,
    workflowSource: source.workflowSource,
    workflowSnapshot: definition,
    workflowVersion: source.workflowVersion,
    objective: source.objective,
    repoId: source.repoId,
    // In-place: the repo's own checkout (placement re-derives it; see workflow-run-host-access).
    worktreeId: source.worktreeId ?? getRepoMainWorktreeId(repo),
    concurrencyLimit: source.concurrencyLimit,
    ...(args.startedByClient ? { startedByClient: args.startedByClient } : {}),
    rerunOfRunId: source.id,
    ...(fromNodeId ? { rerunFromNodeId: fromNodeId } : {})
  })
  deps.launch(rerun)
  return rerun
}
