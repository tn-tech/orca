// Why: every RPC response needs the same runtimeId envelope, and the
// runtime/browser error allowlists define the contract the CLI relies on to
// format human-facing messages. Centralizing this mapping keeps the allowlist
// auditable in one place instead of spread across per-method branches.
import type { RpcEnvelopeMeta, RpcFailure, RpcSuccess } from './core'
import { computerUseErrorRecoveryData } from '../../../shared/computer-use-error-recovery'
import { COMPUTER_ERROR_CODES } from '../../../shared/runtime-types'
import { LINEAR_ERROR_CODES } from '../../../shared/linear/agent-access'
import { AGENT_SESSION_RPC_ERROR_CODES } from '../../../shared/agent-session-host-authority'
import { ARTIFACT_SHARING_DISABLED_CODE } from '../../../shared/artifact-sharing-gate'
import { AGENT_SKILL_SHARING_DISABLED_CODE } from '../../../shared/agent-skill-sharing-gate'
import {
  AGENT_SKILL_NOT_SHAREABLE_CODE,
  AGENT_SKILL_SELECTOR_AMBIGUOUS_CODE,
  AGENT_SKILL_SELECTOR_NOT_FOUND_CODE,
  AGENT_SKILL_SHARING_BUSY_CODE,
  AGENT_SKILL_SHARING_UNSUPPORTED_ENVIRONMENT_CODE
} from '../../../shared/agent-skill-sharing-contract'
import {
  SKILL_INSTALL_RPC_ERROR_CODE,
  classifySkillInstallFailureCode
} from '../../../shared/skill-install-failure'
import { GIT_DIFF_TOO_LARGE_CODE } from '../../../shared/git-diff-transport-budget'
import { AUTOMATION_OWNER_CONFLICT_CODES } from '../../../shared/automation-owner-conflict'
import { ARCHIVE_HOOK_FAILED_REMOVAL_CODE } from '../../../shared/worktree/archive-hook-removal-gate'
import { NESTED_WORKER_DEPTH_EXCEEDED_CODE } from '../../../shared/nested-worker-depth'
import { WORKTREE_CREATE_COLLISION_CODE } from '../../../shared/new-workspace/worktree-create-collision'

export function successResponse(id: string, meta: RpcEnvelopeMeta, result: unknown): RpcSuccess {
  return {
    id,
    ok: true,
    result,
    _meta: meta
  }
}

export function errorResponse(
  id: string,
  meta: RpcEnvelopeMeta,
  code: string,
  message: string,
  data?: unknown
): RpcFailure {
  return {
    id,
    ok: false,
    error: data === undefined ? { code, message } : { code, message, data },
    _meta: meta
  }
}

// Why: the OrcaRuntimeService throws plain Error objects whose `message` is
// actually a stable error code. This allowlist is the contract the CLI relies
// on — expanding or renaming entries without updating the CLI would silently
// change user-visible error codes.
const RUNTIME_PASSTHROUGH_CODES: ReadonlySet<string> = new Set([
  WORKTREE_CREATE_COLLISION_CODE,
  'agent_launch_replay_unsupported',
  'runtime_unavailable',
  'selector_not_found',
  'selector_ambiguous',
  'terminal_handle_stale',
  'terminal_not_writable',
  'terminal_exited',
  'terminal_gone',
  'terminal_tab_close_timeout',
  'terminal_tab_not_found',
  'terminal_tab_pinned',
  'agent_prompt_blocked',
  'agent_prompt_stalled',
  'no_active_terminal',
  'repo_not_found',
  'timeout',
  'invalid_limit',
  'request_aborted',
  'remote_update_manual_required',
  'remote_update_not_available',
  'remote_update_not_downloaded',
  // Why: U10 registers workflow.* handler skeletons; later units replace this with real logic.
  'workflow_not_implemented',
  // U21 definitions/runs handlers (contracts/rpc-methods.md "Error codes"): the file store's own
  // codes plus the ones this unit's handlers throw directly, all plain `Error(code)` throws.
  // (`workflow_source_not_allowed` rides the structured Set below — it always carries `.data`.)
  'workflow_not_found',
  'workflow_file_conflict',
  'workflow_name_taken',
  'workflow_host_unreachable',
  // U09 file-store codes not otherwise remapped to the contract's `workflow_not_found`/
  // `workflow_invalid` — kept here so an edge case that reaches a caller unwrapped still names
  // itself instead of falling back to generic `runtime_error`.
  'workflow_file_not_found',
  'workflow_name_invalid',
  'workflow_file_invalid',
  'workflow_file_binary',
  ...AGENT_SESSION_RPC_ERROR_CODES
])

const COMPUTER_PASSTHROUGH_CODES: ReadonlySet<string> = new Set(Object.values(COMPUTER_ERROR_CODES))
const LINEAR_PASSTHROUGH_CODES: ReadonlySet<string> = new Set(LINEAR_ERROR_CODES)
const STRUCTURED_RUNTIME_PASSTHROUGH_CODES: ReadonlySet<string> = new Set([
  WORKTREE_CREATE_COLLISION_CODE,
  'worktree_id_requires_full_path',
  'run_not_found',
  'run_required',
  'stable_pane_required',
  'consumer_fenced',
  // Why: a terminal caller on an engine-owned Run must learn the workflow owns it, not a generic fence.
  'workflow_owned_run',
  'task_not_found',
  'task_not_startable',
  'inject_rejected',
  'dispatch_not_found',
  'dispatch_run_mismatch',
  'terminal_not_found',
  // A handle that names a live agent session with no terminal. Distinct from
  // `terminal_handle_stale`, which claims the handle went dead — nothing went stale here.
  'terminal_unsupported_for_agent_session',
  'recipient_ambiguous',
  'recipient_run_mismatch',
  'dispatch_inactive',
  'worker_identity_changed',
  'cursor_invalid',
  'cursor_dispatch_mismatch',
  'source_changed',
  'transcript_required',
  'server_required',
  'worktree_not_found_on_server',
  'resource_server_mismatch',
  'peer_changed',
  'remote_runtime_unavailable',
  'runtime_timeout',
  'invalid_runtime_response',
  'capability_unsupported',
  'relay_quota_exceeded',
  'dispatch_capability_invalid',
  'agent_unconfigured',
  'worker_prompt_too_large',
  'terminal_worktree_mismatch',
  'terminal_is_coordinator',
  'request_mismatch',
  'mutation_ledger_full',
  'legacy_read_only',
  'orchestration_migration_required',
  'operation_unknown',
  'dispatch_preamble_undelivered',
  'question_not_found',
  'answer_conflict',
  'stale_delivery',
  'waiter_exists',
  'invalid_argument',
  // Why (#19334): "your archive hook failed, nothing was deleted" is a distinct decision — retry,
  // waive, or skip the hook. Flattened to runtime_error a caller can only pattern-match the text.
  ARCHIVE_HOOK_FAILED_REMOVAL_CODE,
  // Why here and not only on the transport: a method that admits paired clients only refuses
  // with the same code the mobile-allowlist check does, so a caller reads one answer either way.
  'forbidden',
  NESTED_WORKER_DEPTH_EXCEEDED_CODE,
  GIT_DIFF_TOO_LARGE_CODE,
  // Why: U21's workflow.write/duplicate/run.start carry the file/graph problems list (and, for
  // the allowlist refusal, the disallowed source + allowlist path) as `.data`; a plain
  // message-only code would lose it, so these ride the structured (`.code`/`.data`) branch instead.
  'workflow_invalid',
  'workflow_file_version_unsupported',
  'workflow_source_not_allowed',
  // workflow.run.answer/sendMessage: a client drops a question someone else answered first, or
  // stops offering actions on a finished run, rather than reading a generic failure.
  'workflow_question_not_pending',
  'workflow_run_not_active',
  // workflow.proposal.accept/export: the client stops offering an action the proposal no longer
  // allows, or explains that only an imported role has an origin to export to.
  'workflow_proposal_not_found',
  'workflow_proposal_not_pending',
  'workflow_role_not_found',
  'workflow_role_not_imported',
  'workflow_role_name_invalid',
  ARTIFACT_SHARING_DISABLED_CODE,
  AGENT_SKILL_SHARING_DISABLED_CODE,
  AGENT_SKILL_NOT_SHAREABLE_CODE,
  AGENT_SKILL_SELECTOR_AMBIGUOUS_CODE,
  AGENT_SKILL_SELECTOR_NOT_FOUND_CODE,
  AGENT_SKILL_SHARING_BUSY_CODE,
  AGENT_SKILL_SHARING_UNSUPPORTED_ENVIRONMENT_CODE,
  SKILL_INSTALL_RPC_ERROR_CODE,
  // Why: an owner conflict is a distinct client decision (reload the host, re-adopt,
  // stop offering the action) — flattened to runtime_error it can only be guessed at.
  ...Object.values(AUTOMATION_OWNER_CONFLICT_CODES)
])

export function mapRuntimeError(id: string, meta: RpcEnvelopeMeta, error: unknown): RpcFailure {
  const message = error instanceof Error ? error.message : String(error)
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    COMPUTER_PASSTHROUGH_CODES.has((error as { code: string }).code)
  ) {
    const code = (error as { code: string }).code
    return errorResponse(id, meta, code, message, computerErrorData(code, message))
  }
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('LINEAGE_')
  ) {
    return errorResponse(
      id,
      meta,
      (error as { code: string }).code,
      message,
      (error as { data?: unknown }).data
    )
  }
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    LINEAR_PASSTHROUGH_CODES.has((error as { code: string }).code)
  ) {
    return errorResponse(
      id,
      meta,
      (error as { code: string }).code,
      message,
      (error as { data?: unknown }).data
    )
  }
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    STRUCTURED_RUNTIME_PASSTHROUGH_CODES.has((error as { code: string }).code)
  ) {
    return errorResponse(
      id,
      meta,
      (error as { code: string }).code,
      message,
      (error as { data?: unknown }).data
    )
  }
  if (RUNTIME_PASSTHROUGH_CODES.has(message)) {
    return errorResponse(id, meta, message, message)
  }
  const skillInstallFailure = classifySkillInstallFailureCode(message)
  if (skillInstallFailure) {
    return errorResponse(
      id,
      meta,
      SKILL_INSTALL_RPC_ERROR_CODE,
      skillInstallFailure.code,
      skillInstallFailure
    )
  }
  if (message === 'invalid_terminal_send') {
    return errorResponse(id, meta, 'invalid_argument', 'Missing terminal send payload')
  }
  return errorResponse(id, meta, 'runtime_error', message)
}

export const computerErrorData = computerUseErrorRecoveryData

// Why: browser errors carry a structured .code property (BrowserError from
// cdp-bridge.ts) that maps directly to agent-facing error codes. We forward
// that code rather than falling back to the runtime allowlist, because the
// browser surface area uses its own code namespace (browser_no_tab, etc.).
export function mapBrowserError(id: string, meta: RpcEnvelopeMeta, error: unknown): RpcFailure {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return errorResponse(id, meta, (error as { code: string }).code, error.message)
  }
  return mapRuntimeError(id, meta, error)
}

// Why: same as browser — emulator errors (EmulatorError) carry .code (emulator_no_active etc.)
// so we forward the structured code instead of generic runtime_error.
export function mapEmulatorError(id: string, meta: RpcEnvelopeMeta, error: unknown): RpcFailure {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return errorResponse(id, meta, (error as { code: string }).code, error.message)
  }
  return mapRuntimeError(id, meta, error)
}
