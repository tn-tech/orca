import { installRuntimeLinearCommandSurface } from './runtime-linear-command-surface'
import { OrcaRuntimeWithResolveWaiter } from './orca-runtime-resolve-waiter'
import type { RuntimeCommandSurfaceHost } from './orca-runtime-core'
import { registerWorktreeChangeInvalidator } from '../ipc/worktree-change-invalidators'
import { registerDetectedWorktreeScanInvalidation } from '../ipc/worktrees/listing/register-detected-worktree-scan-invalidation'
import { ORCHESTRATION_METHODS } from './rpc/methods/orchestration'
import { RpcDispatcher } from './rpc/dispatcher'
import { WorkflowEngine } from './workflows/workflow-engine'

class OrcaRuntimeService extends OrcaRuntimeWithResolveWaiter {
  private workflowEngine: WorkflowEngine | null = null

  constructor(...args: ConstructorParameters<typeof OrcaRuntimeWithResolveWaiter>) {
    super(...args)
    // Why: the runtime listing re-runs a scan the worktree-change generation overtook and re-lists
    // through this runtime's scan cache, so a worktree change must reach both. The desktop IPC
    // module registers the generation bump at load; a headless host never loads it.
    registerDetectedWorktreeScanInvalidation()
    registerWorktreeChangeInvalidator((repoId) => this.invalidateWorktreeCatalog(repoId))
  }

  /**
   * Lazily built like `getOrchestrationDb()` (same file, mixed in below): built on first use
   * rather than in the constructor, so an idle runtime never creates an orchestration DB. Building
   * it rehydrates every run a prior process left non-terminal (FR-039), so a host that starts
   * workflows at all must call this once during its own startup, not only when a client asks.
   */
  getWorkflowEngine(): WorkflowEngine {
    if (!this.workflowEngine) {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the command
      // surfaces (waitForMessage, browser commands, …) are installed onto this instance by the
      // OrcaRuntimeWith* mixin chain the constructor runs through; this is the same cast
      // orca-runtime-state-fields.ts uses internally to type them.
      const runtime = this as unknown as OrcaRuntimeServiceExport
      this.workflowEngine = new WorkflowEngine({
        db: this.getOrchestrationDb(),
        runtime,
        dispatcher: new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS }),
        getRepo: (repoId) => this.store?.getRepo(repoId)
      })
      this.workflowEngine.rehydrateActiveRuns()
    }
    return this.workflowEngine
  }

  /** Stops every active run controller; called on shutdown so a worker's mailbox is left quiet. */
  async stopWorkflowEngine(): Promise<void> {
    await this.workflowEngine?.stop()
  }
}
type OrcaRuntimeServiceExport = RuntimeCommandSurfaceHost<OrcaRuntimeService>
const OrcaRuntimeServiceExport = OrcaRuntimeService as unknown as {
  new (...args: ConstructorParameters<typeof OrcaRuntimeService>): OrcaRuntimeServiceExport
  readonly prototype: OrcaRuntimeServiceExport
}
export { OrcaRuntimeServiceExport as OrcaRuntimeService }
installRuntimeLinearCommandSurface(OrcaRuntimeServiceExport.prototype)

export type { LegacyWorkerTerminalRecoveryResult } from './runtime-legacy-worker-terminal-recovery-types'
export type {
  RuntimeAutomationCreateInput,
  RuntimeAutomationUpdateInput
} from './runtime-automation-controller'
export type { SubscriptionRegistration } from './runtime-subscription-registry'
export type {
  OrchestrationCompatibilityCallerAuthority,
  OrchestrationCompatibilityTerminalAuthority,
  RuntimePtyDataAdmission,
  RuntimeTerminalAgentStatusEvent
} from './runtime-terminal-contracts'
export type { MessageWaitResult } from './runtime-message-waiters'
export type { AccountsSnapshot, CodexRateLimitResetRpcResult } from './runtime-account-controller'
export type {
  MobileNotificationDispatchEvent,
  MobileNotificationDismissEvent,
  MobileNotificationEvent
} from './runtime-mobile-notification-controller'
export type { RuntimeTerminalDataMeta } from './runtime-terminal-stream-consumers'
export type { RemoteFetchResult, RemoteTrackingBase } from './runtime-remote-fetch-controller'
export {
  computeTerminalTailWaitState,
  tailGainedNewerBlockedReason,
  type TerminalTailWaitState
} from './terminal-wait-tail-state'
export { appendNormalizedToTailBuffer } from './terminal-tail-buffer'
export { appendNormalizedToMultilineTailBufferUnwindowed } from './terminal-tail-redraw-buffer'
export { buildPreview } from './terminal-tail-state'
export { buildRestoredTerminalTailSeed } from './terminal-tail-restore-seed'
export { projectTerminalTailLines } from './orca-runtime-terminal-projection'
export { resolveWorktreeScanCacheTtlMs } from './runtime-worktree-scan-cache'
export type {
  RuntimeWorktreeLifecycleEvent,
  DriverState,
  PtyLayoutTarget,
  PtyLayoutState,
  ApplyLayoutResult,
  RuntimeRendererReloadFence
} from './orca-runtime-core'
export {
  AUTHORITATIVE_TERMINAL_SNAPSHOT_TIMEOUT_MS,
  WORKTREE_SCAN_ADMIN_RECONCILE_INTERVAL_MS,
  WORKTREE_SCAN_ADMIN_FINGERPRINT_TIMEOUT_MS
} from './orca-runtime-postlude'
