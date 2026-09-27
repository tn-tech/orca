// On worker_done: validates the reported result.json against the node's result contract and
// checks its declared artifacts, producing the structured value/artifacts to store or a precise
// failure reason (contracts/agent-brief.md "Engine validation on worker_done", spec.md FR-027).
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { ResultContract } from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptArtifact } from '../../../shared/workflows/workflow-run-types'
import type { WorkerReportOutcome } from '../orchestration/types'
import { joinWorktreeRelativePath, normalizeRuntimeRelativePath } from '../runtime-relative-paths'
import type { ArtifactGlobTruncation } from './workflow-artifact-glob'
import { resolveArtifacts, type ArtifactSpec } from './workflow-artifact-resolution'
import type { ResultSchemaValidation } from './workflow-result-schema'
import { createResultSchemaValidator } from './workflow-result-schema'
import type { WorkflowFilesystem } from './workflow-file-store-filesystem'

/**
 * The `loop_*` reasons fail a Loop node: cap reached, a failed body node, or an exit never reached.
 * The `join_*` reasons fail a Join: a branch failed under `onFailure: fail`, or its policy is out of reach.
 */
export const WORKFLOW_RESULT_FAILURE_REASONS = [
  'result_missing',
  'result_invalid',
  'artifact_missing',
  'worker_failed',
  'loop_cap_reached',
  'loop_body_failed',
  'loop_exit_unreached',
  'join_branch_failed',
  'join_unsatisfied'
] as const
export type WorkflowResultFailureReason = (typeof WORKFLOW_RESULT_FAILURE_REASONS)[number]

export type CaptureResultArgs = {
  fs: WorkflowFilesystem
  /** Run workspace root, host-appropriate (posix for SSH/remote, OS-native for local). */
  workspaceRoot: string
  runId: string
  attemptId: string
  reportPath: string | null | undefined
  outcome: WorkerReportOutcome
  resultContract: ResultContract
  declaredArtifacts: readonly ArtifactSpec[]
  /** Bounds glob expansion: remote workspaces get a smaller directory budget; abort stops it. */
  artifactGlob?: { remote?: boolean; signal?: AbortSignal }
}

/**
 * `ok: true` only when the result validates, every required artifact exists, and the worker
 * reported `succeeded`. Every failure carries a `failureReason`: `worker_failed` covers an
 * otherwise-valid result whose worker reported `outcome: 'failed'` (contracts/agent-brief.md
 * validation #4), even though no earlier validation step found a problem.
 */
export type CaptureResultOutcome =
  | {
      ok: true
      result: JsonValue
      artifacts: WorkflowAttemptArtifact[]
      /** Globs whose walk hit a limit yet still matched; recorded as `artifact_glob_truncated`. */
      artifactGlobTruncations?: { pattern: string; reason: ArtifactGlobTruncation }[]
    }
  | {
      ok: false
      failureReason: WorkflowResultFailureReason
      /** Why a parsed result was rejected, when the reason alone does not say. */
      detail?: string
      rawBody?: string
      result?: JsonValue
      artifacts?: WorkflowAttemptArtifact[]
    }

function attemptDir(runId: string, attemptId: string): string {
  return `.orca/workflow-runs/${runId}/${attemptId}`
}

/** `reportPath` must resolve inside this attempt's own directory (agent-brief.md validation #1). */
function reportPathWithinAttemptDir(reportPath: string, runId: string, attemptId: string): boolean {
  try {
    const normalized = normalizeRuntimeRelativePath(reportPath)
    return normalized.startsWith(`${attemptDir(runId, attemptId)}/`)
  } catch {
    return false
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** result.json's optional top-level `artifacts` list adds paths beyond the node's declared ones. */
function extraArtifactPaths(parsed: unknown): string[] {
  if (!isPlainObject(parsed) || !Array.isArray(parsed.artifacts)) {
    return []
  }
  return parsed.artifacts.filter((path): path is string => typeof path === 'string')
}

/** The structured value validated/stored downstream never carries the reserved `artifacts` key. */
function valueWithoutArtifacts(parsed: unknown): unknown {
  if (!isPlainObject(parsed)) {
    return parsed
  }
  const { artifacts: _artifacts, ...rest } = parsed
  return rest
}

/** A malformed resultContract (authoring bug) fails the same way as a value that violates it. */
function safeValidateResult(contract: ResultContract, value: unknown): ResultSchemaValidation {
  try {
    return createResultSchemaValidator(contract).validate(value)
  } catch {
    return { ok: false, issues: ['resultContract could not be compiled as a JSON Schema'] }
  }
}

function mergeArtifactSpecs(
  declared: readonly ArtifactSpec[],
  extraPaths: readonly string[]
): ArtifactSpec[] {
  const merged = new Map<string, ArtifactSpec>(declared.map((spec) => [spec.path, spec]))
  for (const path of extraPaths) {
    if (!merged.has(path)) {
      merged.set(path, { path, required: false })
    }
  }
  return [...merged.values()]
}

export async function captureNodeResult(args: CaptureResultArgs): Promise<CaptureResultOutcome> {
  const { fs, workspaceRoot, runId, attemptId, reportPath, outcome, resultContract } = args

  if (!reportPath || !reportPathWithinAttemptDir(reportPath, runId, attemptId)) {
    return { ok: false, failureReason: 'result_missing' }
  }

  let rawBody: string
  try {
    rawBody = await fs.readFile(joinWorktreeRelativePath(workspaceRoot, reportPath))
  } catch {
    return { ok: false, failureReason: 'result_missing' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return { ok: false, failureReason: 'result_invalid', rawBody }
  }

  const validation = safeValidateResult(resultContract, valueWithoutArtifacts(parsed))
  if (!validation.ok) {
    return { ok: false, failureReason: 'result_invalid', rawBody }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: resultContract is always `{type:'object',...}` (ResultContractSchema); z.fromJSONSchema output for such a contract is JSON-serializable data.
  const result = validation.value as JsonValue

  const specs = mergeArtifactSpecs(args.declaredArtifacts, extraArtifactPaths(parsed))
  const { artifacts, missingRequired, truncations, missingDetail } = await resolveArtifacts(
    fs,
    workspaceRoot,
    specs,
    args.artifactGlob
  )
  if (missingRequired) {
    return {
      ok: false,
      failureReason: 'artifact_missing',
      ...(missingDetail ? { detail: missingDetail } : {}),
      result,
      artifacts
    }
  }

  if (outcome === 'failed') {
    return { ok: false, failureReason: 'worker_failed', result, artifacts }
  }

  return {
    ok: true,
    result,
    artifacts,
    ...(truncations.length > 0 ? { artifactGlobTruncations: truncations } : {})
  }
}
