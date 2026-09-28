// What one controller holds for its run while it runs: the engine Run's mailbox, the engine
// principal's orchestration client, and the node-launch and follow-up contexts built on it.
import type { RunSnapshot } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { AgentAnswerDeliveryBackoff } from './workflow-agent-answer-delivery'
import { resolveFollowUpWorker, type FollowUpDeliveryContext } from './workflow-follow-up-delivery'
import type { TerminalPromptProgress } from './workflow-follow-up-interrupt'
import {
  createWorkflowOrchestrationClient,
  createWorkflowWorkerInputClient,
  type WorkflowOrchestrationClient,
  type WorkflowOrchestrationDispatcher
} from './workflow-orchestration-client'
import type {
  WorkflowNodeLaunchContext,
  WorkflowRunWorkspaceAccess
} from './workflow-run-node-launch'
import type { WorkflowRunRecorder } from './workflow-run-recorder'

export type ControllerSession = {
  engineRunId: string
  consumerGeneration: number
  client: WorkflowOrchestrationClient
  launch: WorkflowNodeLaunchContext
  followUps: FollowUpDeliveryContext
}

export type ControllerSessionDeps = {
  db: OrchestrationDb
  dispatcher: WorkflowOrchestrationDispatcher
  recorder: WorkflowRunRecorder
  signal: AbortSignal
  followUpBackoff: AgentAnswerDeliveryBackoff
  resolveWorkspace(run: RunSnapshot): Promise<WorkflowRunWorkspaceAccess>
  sendTerminalPrompt(
    handle: string,
    prompt: string,
    progress: TerminalPromptProgress
  ): Promise<{ accepted: boolean }>
}

export async function openControllerSession(
  deps: ControllerSessionDeps,
  run: RunSnapshot
): Promise<ControllerSession> {
  const { db, recorder } = deps
  const engineRun =
    db.getRunForWorkflowRun(run.id) ??
    db.createWorkflowEngineRun({ workflowRunId: run.id, objective: run.objective })
  const workspace = await deps.resolveWorkspace(run)
  const placementWorktreeId = workspace.worktreeId ?? run.worktreeId
  const engine = {
    dispatcher: deps.dispatcher,
    principal: {
      kind: 'workflow-engine' as const,
      workflowRunId: run.id,
      ...(placementWorktreeId ? { worktreeId: placementWorktreeId } : {})
    }
  }
  const client = createWorkflowOrchestrationClient(engine)
  return {
    engineRunId: engineRun.id,
    consumerGeneration: engineRun.consumer_generation,
    client,
    launch: {
      db,
      recorder,
      client,
      workflowName: run.workflowName,
      objective: run.objective,
      definition: run.workflowSnapshot,
      workspace,
      placementWorktreeId,
      signal: deps.signal
    },
    followUps: {
      db,
      recorder,
      client,
      workerInput: createWorkflowWorkerInputClient(engine),
      sendTerminalPrompt: deps.sendTerminalPrompt,
      resolveWorker: (dispatchId) => resolveFollowUpWorker(db, dispatchId),
      backoff: deps.followUpBackoff
    }
  }
}
