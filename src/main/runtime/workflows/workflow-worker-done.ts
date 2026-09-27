// A worker's `worker_done` report: capture its result (or failure) onto the attempt and settle the
// attempt and its orchestration Task. The controller advances the frontier afterwards.
import type { MessageRow } from '../orchestration/types'
import { releaseAgentQuestionWait } from './workflow-agent-questions'
import { artifactsFor, resultContractFor } from './workflow-brief-builder'
import { captureNodeResult } from './workflow-result-capture'
import { captureRouterResult, recordRouterChoice } from './workflow-router'
import type { RunMail } from './workflow-run-mailbox-message'
import { requireBriefNode, type WorkflowNodeLaunchContext } from './workflow-run-node-launch'

export async function ensureTaskStatus(
  ctx: WorkflowNodeLaunchContext,
  taskId: string | undefined,
  status: 'completed' | 'failed'
): Promise<void> {
  if (taskId && ctx.db.getTask(taskId)?.status !== status) {
    await ctx.client.call('orchestration.taskUpdate', { id: taskId, status })
  }
}

/** `false` when the report was stale (the attempt had already settled) and nothing changed. */
export async function handleWorkerDone(
  ctx: WorkflowNodeLaunchContext,
  message: MessageRow,
  mail: Extract<RunMail, { kind: 'worker_done' }>
): Promise<boolean> {
  const { db, recorder } = ctx
  // A worker that finished while its question was open no longer needs the answer.
  const attempt = releaseAgentQuestionWait(ctx, mail.attempt) ?? mail.attempt
  const received = { messageId: message.id, dispatchId: mail.dispatchId, outcome: mail.outcome }
  // Replayed deliveries and late reports find the attempt already settled.
  if (attempt.state !== 'running' && attempt.state !== 'unverifiable') {
    recorder.event(
      'worker_done_stale',
      { ...received, attemptState: attempt.state },
      { attemptId: attempt.id, reason: 'attempt' }
    )
    return false
  }
  recorder.event(
    'worker_done_received',
    { ...received, reportPath: mail.reportPath },
    { attemptId: attempt.id, reason: 'attempt' }
  )
  if (attempt.state === 'unverifiable') {
    recorder.transitionAttempt(attempt.id, 'running')
  }
  const node = requireBriefNode(ctx.definition, attempt.nodeId)
  const captureArgs = {
    fs: ctx.workspace.fs,
    workspaceRoot: ctx.workspace.workspaceRoot,
    runId: recorder.runId,
    attemptId: attempt.id,
    reportPath: mail.reportPath,
    outcome: mail.outcome,
    declaredArtifacts: artifactsFor(node),
    artifactGlob: {
      remote: ctx.workspace.orcaIgnoreTarget.host === 'remote',
      ...(ctx.signal ? { signal: ctx.signal } : {})
    }
  }
  const capture =
    node.type === 'router'
      ? await captureRouterResult(node, captureArgs)
      : await captureNodeResult({ ...captureArgs, resultContract: resultContractFor(node) })
  // Why: a stopped controller leaves the delivery unacknowledged, so the next one re-captures it.
  if (ctx.signal?.aborted) {
    return false
  }
  if (capture.ok) {
    for (const truncation of capture.artifactGlobTruncations ?? []) {
      recorder.event('artifact_glob_truncated', truncation, {
        attemptId: attempt.id,
        reason: 'attempt'
      })
    }
    db.updateWorkflowAttempt(attempt.id, {
      resultJson: capture.result,
      artifactsJson: capture.artifacts
    })
    // Why: taskCreate readies a successor only once every dep Task is completed.
    await ensureTaskStatus(ctx, attempt.taskId, 'completed')
    if (node.type === 'router') {
      recordRouterChoice(recorder, attempt, capture.result)
    }
    recorder.transitionAttempt(attempt.id, 'completed')
    return true
  }
  db.updateWorkflowAttempt(attempt.id, {
    failureReason: capture.failureReason,
    ...(capture.result !== undefined ? { resultJson: capture.result } : {}),
    ...(capture.artifacts ? { artifactsJson: capture.artifacts } : {})
  })
  await ensureTaskStatus(ctx, attempt.taskId, 'failed')
  recorder.transitionAttempt(attempt.id, 'failed', {
    workerReport: message.body,
    ...(capture.detail !== undefined ? { detail: capture.detail } : {}),
    ...(capture.rawBody !== undefined ? { rawBody: capture.rawBody } : {})
  })
  return true
}
