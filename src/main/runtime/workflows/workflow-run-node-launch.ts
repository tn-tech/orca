// Starts one frontier-eligible node: Start/End/Join settle at once, an Approval opens its gate; a
// role-dispatching node gets its attempt, brief, just-in-time Task and worker (research R3, R5;
// FR-024, FR-026).
import type { BriefReferenceInputs } from '../../../shared/workflows/workflow-brief-references'
import type { Node, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import { openApproval } from './workflow-approval-gates'
import { writeBrief, type BriefNode, type OrcaIgnoreTarget } from './workflow-brief-builder'
import type { WorkflowFilesystem } from './workflow-file-store-filesystem'
import { createNodeTask } from './workflow-frontier-node-task'
import { joinBranchesInput, settleJoin } from './workflow-join-settlement'
import { loopPreviousInputs } from './workflow-loop-unrolling'
import { resolveNodeLaunch } from './workflow-node-dispatch'
import { dispatchBriefAttempt, nodeSkills } from './workflow-brief-attempt-dispatch'
import { buildRunRecord } from './workflow-brief-run-record'
import type { WorkflowOrchestrationClient } from './workflow-orchestration-client'
import type { WorkflowRunRecorder } from './workflow-run-recorder'
import { loadRunFallbackSkillTexts } from './workflow-skill-fallback-text'
import { answeredTrustWaits, leaveRunWaitIfClear } from './workflow-trust-wait'

/** Where a run's node attempts write and read their files, on the run's execution host. */
export type WorkflowRunWorkspaceAccess = {
  /** Worker placement for the engine principal; absent means the run's own worktree id. */
  worktreeId?: string
  workspaceRoot: string
  fs: WorkflowFilesystem
  orcaIgnoreTarget: OrcaIgnoreTarget
}

export type WorkflowNodeLaunchContext = {
  db: OrchestrationDb
  recorder: WorkflowRunRecorder
  client: WorkflowOrchestrationClient
  workflowName: string
  objective: string
  definition: Workflow
  workspace: WorkflowRunWorkspaceAccess
  placementWorktreeId: string | undefined
  /** The controller's stop signal; long host walks (artifact globs) end early when it fires. */
  signal?: AbortSignal
}

/** Node types the engine dispatches to a worker; the only ones a concurrency slot gates (workflow-concurrency.ts). */
export const WORKER_DISPATCH_NODE_TYPES: ReadonlySet<Node['type']> = new Set([
  'agent',
  'router',
  'reflection'
])

function isBriefNode(node: Node): node is BriefNode {
  return WORKER_DISPATCH_NODE_TYPES.has(node.type)
}

export function requireBriefNode(definition: Workflow, nodeId: string): BriefNode {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || !isBriefNode(node)) {
    throw new Error(`Workflow node ${nodeId} does not dispatch a worker.`)
  }
  return node
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isNewer(candidate: NodeAttemptView, current: NodeAttemptView | undefined): boolean {
  return (
    !current ||
    candidate.iteration > current.iteration ||
    (candidate.iteration === current.iteration && candidate.attemptIndex > current.attemptIndex)
  )
}

/** Latest completed result of every node, so `${upstream.<id>...}` resolves for any ancestor. */
export function upstreamInputs(
  attempts: readonly NodeAttemptView[]
): BriefReferenceInputs['upstream'] {
  const latest = new Map<string, NodeAttemptView>()
  for (const attempt of attempts) {
    if (
      attempt.state === 'completed' &&
      attempt.resultJson !== undefined &&
      isNewer(attempt, latest.get(attempt.nodeId))
    ) {
      latest.set(attempt.nodeId, attempt)
    }
  }
  return Object.fromEntries(
    [...latest].map(([nodeId, attempt]) => [
      nodeId,
      {
        result: attempt.resultJson ?? null,
        artifacts: attempt.artifactsJson.filter((a) => a.exists).map((a) => a.path)
      }
    ])
  )
}

/** Start and End have no worker; they complete the moment they become eligible. */
function settleStructuralNode(ctx: WorkflowNodeLaunchContext, node: Node): void {
  const attempt = ctx.recorder.createAttempt(node)
  for (const state of ['provisioning', 'running', 'completed'] as const) {
    ctx.recorder.transitionAttempt(attempt.id, state)
  }
}

/** A Loop's single attempt runs for as long as it iterates (workflow-loop-unrolling.ts). */
function startLoop(ctx: WorkflowNodeLaunchContext, node: Node): void {
  const attempt = ctx.recorder.createAttempt(node)
  ctx.recorder.transitionAttempt(attempt.id, 'provisioning')
  ctx.recorder.transitionAttempt(attempt.id, 'running')
}

async function launchBriefNode(
  ctx: WorkflowNodeLaunchContext,
  node: BriefNode,
  attempts: readonly NodeAttemptView[],
  iteration: number
): Promise<void> {
  const attempt = ctx.recorder.createAttempt(node, iteration)
  const loopPrevious = loopPreviousInputs(ctx.definition, attempts, node.id, iteration)
  const joinBranches = joinBranchesInput(ctx.definition, attempts, node.id)
  let taskId: string
  try {
    const launch = resolveNodeLaunch(node, ctx.definition.roles)
    const skills = nodeSkills(node, ctx.definition.roles)
    // Brief preparation, including this FR-020 SKILL.md fetch, runs while the attempt is `pending`.
    const fallbackSkillTexts = await loadRunFallbackSkillTexts(ctx.workspace, {
      agent: launch.agent,
      skills
    })
    const brief = await writeBrief({
      fs: ctx.workspace.fs,
      workspaceRoot: ctx.workspace.workspaceRoot,
      orcaIgnoreTarget: ctx.workspace.orcaIgnoreTarget,
      workflowName: ctx.workflowName,
      runId: ctx.recorder.runId,
      attemptId: attempt.id,
      iteration: attempt.iteration,
      node,
      systemPrompt: launch.systemPrompt,
      skills,
      agent: launch.agent,
      fallbackSkillTexts,
      ...(node.type === 'reflection'
        ? {
            reflection: {
              runRecord: buildRunRecord(ctx.definition, attempts, node.id),
              roles: ctx.definition.roles
            }
          }
        : {}),
      briefInputs: {
        objective: ctx.objective,
        upstream: upstreamInputs(attempts),
        ...(loopPrevious ? { loopPrevious } : {}),
        ...(joinBranches === undefined ? {} : { joinBranches })
      }
    })
    taskId = await createNodeTask(ctx.client, {
      definition: ctx.definition,
      attempts,
      nodeId: node.id,
      iteration: attempt.iteration,
      spec: brief.taskSpec
    })
    ctx.db.updateWorkflowAttempt(attempt.id, {
      taskId,
      briefPath: brief.briefPath,
      resultPath: brief.resultPath,
      ...(ctx.placementWorktreeId ? { workspaceWorktreeId: ctx.placementWorktreeId } : {})
    })
  } catch (error) {
    ctx.recorder.failBeforeDispatch(attempt.id, errorMessage(error))
    return
  }
  await dispatchBriefAttempt(ctx, node, attempt.id, taskId)
}

/**
 * Re-dispatches every attempt whose trust question was answered (FR-018a) through the normal
 * dispatch path; `true` when any resumed. Only this run's single controller calls it, and the
 * attempt leaves `waiting` synchronously before any await, so it never dispatches twice.
 */
export async function resumeAnsweredTrustWaits(ctx: WorkflowNodeLaunchContext): Promise<boolean> {
  // A pause holds the worker launch back; the controller's next pass after resume retries it.
  if (ctx.db.getWorkflowRun(ctx.recorder.runId)?.state === 'paused') {
    return false
  }
  const resumable = answeredTrustWaits(ctx.db, ctx.recorder.runId)
  for (const attempt of resumable) {
    const node = requireBriefNode(ctx.definition, attempt.nodeId)
    if (attempt.taskId) {
      await dispatchBriefAttempt(ctx, node, attempt.id, attempt.taskId)
    }
  }
  if (resumable.length > 0) {
    leaveRunWaitIfClear(ctx.db, ctx.recorder)
  }
  return resumable.length > 0
}

/** `iteration` is the Loop iteration for a body node, 0 elsewhere. */
export async function launchEligibleNode(
  ctx: WorkflowNodeLaunchContext,
  nodeId: string,
  attempts: readonly NodeAttemptView[],
  iteration = 0
): Promise<void> {
  const node = ctx.definition.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    throw new Error(`Workflow node ${nodeId} is not in the run's definition.`)
  }
  if (node.type === 'start' || node.type === 'end') {
    settleStructuralNode(ctx, node)
    return
  }
  if (node.type === 'loop') {
    startLoop(ctx, node)
    return
  }
  if (node.type === 'join') {
    await settleJoin(ctx, node, iteration)
    return
  }
  if (node.type === 'approval') {
    await openApproval(ctx, node, attempts, iteration)
    return
  }
  await launchBriefNode(ctx, node, attempts, iteration)
}
