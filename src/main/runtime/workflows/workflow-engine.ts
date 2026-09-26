// Per-runtime registry of active WorkflowRunControllers (FR-022, FR-038, FR-039): starts a run's
// workspace and DB row, tracks live controllers so shutdown can stop them, and rehydrates every
// run a prior process left non-terminal so a Remote Orca Server run survives a restart.
import type { Repo } from '../../../shared/repo-types'
import type { GraphValidationContext } from '../../../shared/workflows/workflow-graph-validation'
import { validateWorkflowGraph } from '../../../shared/workflows/workflow-graph-validation'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowProblem } from '../../../shared/workflows/workflow-problem'
import type { RunSnapshot, WorkflowRunSource } from '../../../shared/workflows/workflow-run-types'
import { getSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import type { OrchestrationDb } from '../orchestration/db'
import { generateId } from '../orchestration/db/generated-id'
import type { OrcaIgnoreTarget } from './workflow-brief-builder'
import { getProjectWorkflowFilesystem } from './workflow-file-store-filesystem'
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

export type WorkflowEngineRuntime = WorkflowRunControllerRuntime &
  RunWorkspaceCreatePort &
  WorkflowEngineWorktreeLookup

export type WorkflowEngineDeps = {
  db: OrchestrationDb
  runtime: WorkflowEngineRuntime
  dispatcher: WorkflowOrchestrationDispatcher
  /** `runtime.store` is protected; the runtime host wires this from its own scope instead. */
  getRepo(repoId: string): Repo | undefined
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

function orcaIgnoreTargetFor(repo: Repo): OrcaIgnoreTarget {
  if (!repo.connectionId) {
    return { host: 'local', repoPath: repo.path }
  }
  const fsProvider = getSshFilesystemProvider(repo.connectionId)
  if (!fsProvider) {
    throw new Error(WORKFLOW_HOST_UNREACHABLE_CODE)
  }
  return { host: 'remote', fsProvider, repoPath: repo.path }
}

type ActiveRun = { controller: WorkflowRunController; done: Promise<void> }

export class WorkflowEngine {
  private readonly active = new Map<string, ActiveRun>()

  constructor(private readonly deps: WorkflowEngineDeps) {}

  /** Validates, creates the run's workspace and DB row, then starts a controller for it (FR-022). */
  async startRun(input: WorkflowStartRunInput): Promise<RunSnapshot> {
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
    const run = this.deps.db.createWorkflowRun({
      id,
      workflowName: input.workflow.name,
      workflowSource: input.workflowSource,
      workflowSnapshot: input.workflow,
      workflowVersion: input.workflowVersion,
      objective: input.objective,
      repoId: input.repo.id,
      // Why repo.id: an in-place run has no worktree, but the column disallows NULL.
      worktreeId: workspace.worktreeId ?? input.repo.id,
      ...(input.concurrencyLimit !== undefined ? { concurrencyLimit: input.concurrencyLimit } : {}),
      ...(input.startedByClient ? { startedByClient: input.startedByClient } : {}),
      ...(input.rerunOfRunId ? { rerunOfRunId: input.rerunOfRunId } : {}),
      ...(input.rerunFromNodeId ? { rerunFromNodeId: input.rerunFromNodeId } : {})
    })
    this.launch(run)
    return run
  }

  /** The DB is the source of truth for run state; the registry only tracks live controllers. */
  getSnapshot(workflowRunId: string): RunSnapshot | undefined {
    return this.deps.db.getWorkflowRun(workflowRunId)
  }

  /** Restarts a controller for every run a prior process left non-terminal (FR-039). */
  rehydrateActiveRuns(): void {
    for (const summary of this.deps.db.listActiveWorkflowRuns()) {
      const run = this.deps.db.getWorkflowRun(summary.id)
      if (run) {
        this.launch(run)
      }
    }
  }

  /** Stops every active controller and waits for its current tick to settle before shutdown. */
  async stop(): Promise<void> {
    const runs = [...this.active.values()]
    for (const { controller } of runs) {
      controller.stop()
    }
    await Promise.allSettled(runs.map((run) => run.done))
    this.active.clear()
  }

  private launch(run: RunSnapshot): void {
    if (this.active.has(run.id)) {
      return
    }
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
      .catch((error: unknown) => this.failOnEscapedError(run.id, error))
      .finally(() => {
        if (this.active.get(run.id)?.controller === controller) {
          this.active.delete(run.id)
        }
      })
    this.active.set(run.id, { controller, done })
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
    const fs = getProjectWorkflowFilesystem(repo)
    const orcaIgnoreTarget = orcaIgnoreTargetFor(repo)
    if (run.workflowSnapshot.workspacePolicy === 'in-place') {
      return { workspaceRoot: repo.path, fs, orcaIgnoreTarget }
    }
    const worktree = await this.deps.runtime.showManagedWorktree(`id:${run.worktreeId}`)
    return { worktreeId: worktree.id, workspaceRoot: worktree.path, fs, orcaIgnoreTarget }
  }
}
