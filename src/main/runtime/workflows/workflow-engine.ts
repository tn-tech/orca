// Per-runtime registry of active WorkflowRunControllers (FR-022, FR-038, FR-039): starts a run's
// workspace and DB row, tracks live controllers so shutdown can stop them, and rehydrates every
// run a prior process left non-terminal so a Remote Orca Server run survives a restart.
import type { Repo } from '../../../shared/repo-types'
import type { GraphValidationContext } from '../../../shared/workflows/workflow-graph-validation'
import { validateWorkflowGraph } from '../../../shared/workflows/workflow-graph-validation'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowProblem } from '../../../shared/workflows/workflow-problem'
import type { RunSnapshot, WorkflowRunSource } from '../../../shared/workflows/workflow-run-types'
import {
  getSshFilesystemProvider,
  onSshFilesystemProviderRegistered,
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE
} from '../../providers/ssh-filesystem-dispatch'
import type { OrchestrationDb } from '../orchestration/db'
import { generateId } from '../orchestration/db/generated-id'
import type { OrcaIgnoreTarget } from './workflow-brief-builder'
import { resolveConcurrencyLimit } from './workflow-concurrency'
import {
  getProjectWorkflowFilesystem,
  type WorkflowFilesystem
} from './workflow-file-store-filesystem'
import type { WorkflowRunWorkspaceAccess } from './workflow-run-node-launch'
import type { WorkflowOrchestrationDispatcher } from './workflow-orchestration-client'
import { WorkflowRunController, type WorkflowRunControllerRuntime } from './workflow-run-controller'
import { WorkflowRunRecorder } from './workflow-run-recorder'
import {
  createRunWorkspace,
  resolveInPlaceWorkspace,
  WORKFLOW_HOST_UNREACHABLE_CODE,
  type RunWorkspaceCreatePort
} from './workflow-run-workspace'
import { getRepoWorkflowSourceAllowlist } from './workflow-source-allowlist'

const TERMINAL_RUN_STATES = new Set<RunSnapshot['state']>(['completed', 'failed', 'cancelled'])

// Why bounded and not immediate: a rehydrated run whose host is unreachable at boot (SSH map is
// empty right after a restart) must keep retrying, not spin; `onSshFilesystemProviderRegistered`
// below short-circuits the wait as soon as that specific host reconnects.
const DEFAULT_HOST_UNREACHABLE_RETRY_DELAY_MS = 15_000
// Why bounded: an unbounded stop() risks the host process never exiting if a controller's current
// tick never settles; a run left mid-flight is simply rehydrated on the next boot.
const DEFAULT_SHUTDOWN_DEADLINE_MS = 5_000

/** Thrown by `startRun` when graph validation reports any error-severity problem. */
export class WorkflowGraphValidationError extends Error {
  constructor(readonly problems: WorkflowProblem[]) {
    super('workflow_graph_invalid')
    this.name = 'WorkflowGraphValidationError'
  }
}

/** Turns a run's persisted `worktreeId` back into a path; the minimal slice `worktree.show` needs. */
export type WorkflowEngineWorktreeLookup = {
  showManagedWorktree(worktreeSelector: string): Promise<{ id: string; path: string }>
}

/** Best-effort cleanup of a workspace `startRun` created but could not attach to a DB row. */
export type WorkflowEngineWorktreeCleanup = {
  removeManagedWorktree(worktreeSelector: string): Promise<unknown>
}

export type WorkflowEngineRuntime = WorkflowRunControllerRuntime &
  RunWorkspaceCreatePort &
  WorkflowEngineWorktreeLookup &
  WorkflowEngineWorktreeCleanup

export type WorkflowEngineDeps = {
  db: OrchestrationDb
  runtime: WorkflowEngineRuntime
  dispatcher: WorkflowOrchestrationDispatcher
  /** `runtime.store` is protected; the runtime host wires this from its own scope instead. */
  getRepo(repoId: string): Repo | undefined
  /** Overridable for tests; production keeps the default. */
  hostUnreachableRetryDelayMs?: number
  /** Overridable for tests; production keeps the default. */
  shutdownDeadlineMs?: number
}

export type WorkflowStartRunInput = {
  workflow: Workflow
  workflowSource: WorkflowRunSource
  /** Content hash of the workflow file's raw text — the file store's `revision` (data-model.md §3). */
  workflowVersion: string
  objective: string
  repo: Repo
  startedByClient?: string
  concurrencyLimit?: number
  rerunOfRunId?: string
  rerunFromNodeId?: string
  validation: Pick<GraphValidationContext, 'agentSupportsModel' | 'isKnownAgent'>
}

/** Normalizes the file store's own SSH-unavailable error to the one `isHostUnreachableError` and
 *  the rehydrate-retry path key on, so both fs resolution and ignore-target resolution agree. */
function projectWorkflowFilesystemOrUnreachable(repo: Repo): WorkflowFilesystem {
  try {
    return getProjectWorkflowFilesystem(repo)
  } catch (error) {
    if (error instanceof Error && error.message === SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE) {
      throw new Error(WORKFLOW_HOST_UNREACHABLE_CODE)
    }
    throw error
  }
}

function orcaIgnoreTargetFor(repo: Repo): OrcaIgnoreTarget {
  if (!repo.connectionId) {
    return { host: 'local', repoPath: repo.path }
  }
  const fsProvider = getSshFilesystemProvider(repo.connectionId)
  if (!fsProvider) {
    throw new Error(WORKFLOW_HOST_UNREACHABLE_CODE)
  }
  return { host: 'remote', fsProvider, repoPath: repo.path, connectionId: repo.connectionId }
}

function isHostUnreachableError(error: unknown): boolean {
  return error instanceof Error && error.message === WORKFLOW_HOST_UNREACHABLE_CODE
}

type ActiveRun = { controller: WorkflowRunController; done: Promise<void> }
type PendingRetry = { timer: ReturnType<typeof setTimeout>; unsubscribe: () => void }

export class WorkflowEngine {
  private readonly active = new Map<string, ActiveRun>()
  private readonly pendingRetries = new Map<string, PendingRetry>()
  private stopped = false

  constructor(private readonly deps: WorkflowEngineDeps) {}

  /** Validates, creates the run's workspace and DB row, then starts a controller for it (FR-022). */
  async startRun(input: WorkflowStartRunInput): Promise<RunSnapshot> {
    if (this.stopped) {
      throw new Error('workflow_engine_stopped')
    }
    const allowlistedSources = await getRepoWorkflowSourceAllowlist(input.repo)
    const problems = validateWorkflowGraph(input.workflow, {
      agentSupportsModel: input.validation.agentSupportsModel,
      ...(input.validation.isKnownAgent ? { isKnownAgent: input.validation.isKnownAgent } : {}),
      allowlistedSources
    })
    if (problems.some((problem) => problem.severity === 'error')) {
      throw new WorkflowGraphValidationError(problems)
    }
    // Why generated here: createRunWorkspace names the worktree from the run id, and that
    // workspace must exist before the row referencing it does.
    const id = generateId('wfr')
    const workspace =
      input.workflow.workspacePolicy === 'in-place'
        ? resolveInPlaceWorkspace(input.repo)
        : await createRunWorkspace(
            { id, workflowName: input.workflow.name, repoId: input.repo.id },
            this.deps.runtime
          )
    const run = await this.insertRunRow(input, id, workspace.worktreeId)
    this.launch(run)
    return run
  }

  /** Rolls the just-created workspace back (best effort) if the row insert itself fails. */
  private async insertRunRow(
    input: WorkflowStartRunInput,
    id: string,
    worktreeId: string | undefined
  ): Promise<RunSnapshot> {
    try {
      return this.deps.db.createWorkflowRun({
        id,
        workflowName: input.workflow.name,
        workflowSource: input.workflowSource,
        workflowSnapshot: input.workflow,
        workflowVersion: input.workflowVersion,
        objective: input.objective,
        repoId: input.repo.id,
        // Why repo.id: an in-place run has no worktree, but the column disallows NULL.
        worktreeId: worktreeId ?? input.repo.id,
        // FR-031: an explicit override wins; otherwise honor the workflow file's own default
        // rather than letting the DB's hardcoded default silently override it.
        concurrencyLimit: resolveConcurrencyLimit(input.workflow, input.concurrencyLimit),
        ...(input.startedByClient ? { startedByClient: input.startedByClient } : {}),
        ...(input.rerunOfRunId ? { rerunOfRunId: input.rerunOfRunId } : {}),
        ...(input.rerunFromNodeId ? { rerunFromNodeId: input.rerunFromNodeId } : {})
      })
    } catch (error) {
      if (worktreeId) {
        await this.deps.runtime.removeManagedWorktree(`id:${worktreeId}`).catch((cleanupError) => {
          console.warn(
            `[workflow-engine] failed to remove orphaned worktree ${worktreeId} after a failed run insert:`,
            cleanupError
          )
        })
      }
      throw error
    }
  }

  /** The DB is the source of truth for run state; the registry only tracks live controllers. */
  getSnapshot(workflowRunId: string): RunSnapshot | undefined {
    return this.deps.db.getWorkflowRun(workflowRunId)
  }

  /** Makes a live controller re-read its run now; a run without one catches up on rehydrate. */
  wakeRun(workflowRunId: string): void {
    this.active.get(workflowRunId)?.controller.wake()
  }

  /** Restarts a controller for every run a prior process left non-terminal (FR-039). */
  rehydrateActiveRuns(): void {
    for (const summary of this.deps.db.listActiveWorkflowRuns()) {
      const run = this.deps.db.getWorkflowRun(summary.id)
      if (run) {
        this.launch(run, { rehydrated: true })
      }
    }
  }

  /**
   * Stops every active controller and waits for its current tick to settle, bounded by a
   * deadline: shutdown must not hang on a controller that never yields. Anything left mid-flight
   * is simply rehydrated the next time this host starts.
   */
  async stop(): Promise<void> {
    this.stopped = true
    for (const runId of this.pendingRetries.keys()) {
      this.clearPendingRetry(runId)
    }
    const runs = [...this.active.values()]
    for (const { controller } of runs) {
      controller.stop()
    }
    const deadlineMs = this.deps.shutdownDeadlineMs ?? DEFAULT_SHUTDOWN_DEADLINE_MS
    const settled = Promise.allSettled(runs.map((run) => run.done)).then(() => true as const)
    const timedOut = new Promise<false>((resolve) => {
      setTimeout(() => resolve(false), deadlineMs)
    })
    const finishedInTime = await Promise.race([settled, timedOut])
    if (!finishedInTime) {
      console.warn(
        `[workflow-engine] stop() exceeded its ${deadlineMs}ms deadline with ${runs.length} ` +
          'controller(s) still finishing; they will be rehydrated on the next boot.'
      )
    }
    this.active.clear()
  }

  private launch(run: RunSnapshot, options: { rehydrated: boolean } = { rehydrated: false }): void {
    if (this.stopped || this.active.has(run.id)) {
      return
    }
    this.clearPendingRetry(run.id)
    const controller = new WorkflowRunController({
      workflowRunId: run.id,
      db: this.deps.db,
      runtime: this.deps.runtime,
      dispatcher: this.deps.dispatcher,
      resolveWorkspace: (snapshot) => this.resolveWorkspace(snapshot)
    })
    const done = controller
      .run()
      .then(() => undefined)
      .catch((error: unknown) => {
        // Rehydrating into a still-unreachable host (FR-038) is expected right after a restart;
        // terminal failure for that condition belongs only to startRun's own workspace creation.
        if (options.rehydrated && isHostUnreachableError(error)) {
          this.scheduleHostUnreachableRetry(run)
          return
        }
        this.failOnEscapedError(run.id, error)
      })
      .finally(() => {
        if (this.active.get(run.id)?.controller === controller) {
          this.active.delete(run.id)
        }
      })
    this.active.set(run.id, { controller, done })
  }

  /** Retries a rehydrated run once its host might be reachable again: on a timer, or sooner if
   *  the run's own SSH connection re-registers a filesystem provider. */
  private scheduleHostUnreachableRetry(run: RunSnapshot): void {
    if (this.stopped) {
      return
    }
    const connectionId = this.deps.getRepo(run.repoId)?.connectionId
    const retry = (): void => {
      this.pendingRetries.delete(run.id)
      unsubscribe()
      if (this.stopped) {
        return
      }
      const current = this.deps.db.getWorkflowRun(run.id)
      if (current && !TERMINAL_RUN_STATES.has(current.state)) {
        this.launch(current, { rehydrated: true })
      }
    }
    const delayMs = this.deps.hostUnreachableRetryDelayMs ?? DEFAULT_HOST_UNREACHABLE_RETRY_DELAY_MS
    const timer = setTimeout(retry, delayMs)
    const unsubscribe = connectionId
      ? onSshFilesystemProviderRegistered((registeredConnectionId) => {
          if (registeredConnectionId === connectionId) {
            clearTimeout(timer)
            retry()
          }
        })
      : () => {}
    this.pendingRetries.set(run.id, { timer, unsubscribe })
  }

  private clearPendingRetry(runId: string): void {
    const pending = this.pendingRetries.get(runId)
    if (pending) {
      clearTimeout(pending.timer)
      pending.unsubscribe()
      this.pendingRetries.delete(runId)
    }
  }

  /** A rejection here means the run never reached its own failure handling (e.g. an unreachable host). */
  private failOnEscapedError(workflowRunId: string, error: unknown): void {
    const run = this.deps.db.getWorkflowRun(workflowRunId)
    if (!run || TERMINAL_RUN_STATES.has(run.state)) {
      return
    }
    const recorder = new WorkflowRunRecorder(this.deps.db, this.deps.runtime, workflowRunId)
    recorder.transitionRun('failed', 'run_engine_error', {
      message: error instanceof Error ? error.message : String(error)
    })
  }

  private async resolveWorkspace(run: RunSnapshot): Promise<WorkflowRunWorkspaceAccess> {
    const repo = this.deps.getRepo(run.repoId)
    if (!repo) {
      throw new Error(`Repo ${run.repoId} was not found for workflow run ${run.id}.`)
    }
    const fs = projectWorkflowFilesystemOrUnreachable(repo)
    const orcaIgnoreTarget = orcaIgnoreTargetFor(repo)
    if (run.workflowSnapshot.workspacePolicy === 'in-place') {
      return { workspaceRoot: repo.path, fs, orcaIgnoreTarget }
    }
    const worktree = await this.deps.runtime.showManagedWorktree(`id:${run.worktreeId}`)
    return { worktreeId: worktree.id, workspaceRoot: worktree.path, fs, orcaIgnoreTarget }
  }
}
