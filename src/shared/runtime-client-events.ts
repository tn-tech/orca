import { z } from 'zod'
import type { CreateWorktreeResult } from './worktree/create-types'
import type {
  WorktreeDefaultTabsLaunch,
  WorktreeSetupLaunch,
  WorktreeStartupLaunch
} from './worktree/launch-types'
import type { SshConnectionState } from './ssh-types'
import type { TerminalSideEffectBatch } from './terminal-side-effect-facts'
import type { RuntimeNativeChatLaunchDraftResolution } from './runtime-types'
import { openEnum } from './zod-salvage'

export const WORKFLOW_RUN_CHANGED_REASONS = ['state', 'attempt', 'question', 'message'] as const

export type WorkflowRunChangedReason = (typeof WORKFLOW_RUN_CHANGED_REASONS)[number]

export type RuntimeClientEvent =
  | { type: 'reposChanged' }
  | { type: 'worktreesChanged'; repoId: string }
  | ({ type: 'nativeChatLaunchDraftResolved' } & RuntimeNativeChatLaunchDraftResolution)
  | { type: 'terminalSideEffects'; batch: TerminalSideEffectBatch }
  // Why: SSH connections live on the runtime host; paired clients have no IPC
  // channel for ssh:state-changed, so without this event their reconnect
  // overlays never learn the host connected (STA-1468).
  | { type: 'sshStateChanged'; targetId: string; state: SshConnectionState }
  | {
      type: 'worktreeTerminalSleepState'
      worktreeId: string
      generation: number
      phase: 'started' | 'committed' | 'cancelled' | 'woken'
      ptyIds: string[]
      terminalHandles: string[]
    }
  // Why: automation stores are authority-owned, so clients cannot learn about a
  // run/usage/definition write without the owning authority announcing it.
  | {
      type: 'automationsChanged'
      selector?: { kind: 'self' } | { kind: 'ssh'; targetId: string } | { kind: 'orphan' }
      reason?: 'definition' | 'run' | 'usage'
    }
  // Why: workflow runs are engine-owned, so clients cannot learn about a run/
  // attempt/question/message write without the owning host announcing it. Old
  // clients drop the unknown event type (Rule 1, remote-wire-compatibility.md).
  | {
      type: 'workflowRunChanged'
      runId: string
      reason: WorkflowRunChangedReason
    }
  | {
      type: 'linearLinkedIssueUpdated'
      worktreeId: string
      identifier: string
      workspaceId: string
    }
  | {
      type: 'activateWorktree'
      repoId: string
      worktreeId: string
      setup?: WorktreeSetupLaunch
      startup?: WorktreeStartupLaunch
      defaultTabs?: WorktreeDefaultTabsLaunch
    }

export type RuntimeClientEventStreamMessage =
  | ({ type: 'ready'; subscriptionId: string } & {
      snapshot?: {
        repos?: unknown[]
        sshStates?: { targetId: string; state: SshConnectionState }[]
      }
    })
  | RuntimeClientEvent
  | { type: 'end' }

export type RuntimeActivateWorktreeEvent = Extract<RuntimeClientEvent, { type: 'activateWorktree' }>

export type AutomationsChangedEvent = Extract<RuntimeClientEvent, { type: 'automationsChanged' }>

/** Publisher payload; `selector` scoping is added by a later host-scope step. */
export type AutomationsChangedPayload = Omit<AutomationsChangedEvent, 'type'>

export type PublishAutomationsChanged = (payload: AutomationsChangedPayload) => void

export type WorkflowRunChangedEvent = Extract<RuntimeClientEvent, { type: 'workflowRunChanged' }>

export type WorkflowRunChangedPayload = Omit<WorkflowRunChangedEvent, 'type'>

export type PublishWorkflowRunChanged = (payload: WorkflowRunChangedPayload) => void

// Why openEnum: reason is a wire surface (remote-wire-compatibility.md Rule 4) — a host that
// later adds a reason arm must not have the whole event rejected by an older client. An
// unrecognized reason degrades to 'state', the most conservative refresh.
const workflowRunChangedEventSchema = z.object({
  type: z.literal('workflowRunChanged'),
  runId: z.string().min(1),
  reason: openEnum(WORKFLOW_RUN_CHANGED_REASONS, 'state')
})

/** Admits an unknown wire payload as a `workflowRunChanged` event, or null if it cannot be
 *  (e.g. missing/empty `runId`). Never throws. */
export function admitWorkflowRunChangedEvent(value: unknown): WorkflowRunChangedEvent | null {
  const parsed = workflowRunChangedEventSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function toRuntimeActivateWorktreeEvent(
  repoId: string,
  worktreeId: string,
  setup?: CreateWorktreeResult['setup'],
  startup?: WorktreeStartupLaunch,
  defaultTabs?: CreateWorktreeResult['defaultTabs']
): RuntimeActivateWorktreeEvent {
  return {
    type: 'activateWorktree',
    repoId,
    worktreeId,
    ...(setup ? { setup } : {}),
    ...(startup ? { startup } : {}),
    ...(defaultTabs ? { defaultTabs } : {})
  }
}
