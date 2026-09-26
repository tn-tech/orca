// On worker_done: validates the reported result.json against the node's result contract and
// checks its declared artifacts, producing the structured value/artifacts to store or a precise
// failure reason (contracts/agent-brief.md "Engine validation on worker_done", spec.md FR-027).
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { ResultContract } from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptArtifact } from '../../../shared/workflows/workflow-run-types'
import type { WorkerReportOutcome } from '../orchestration/types'
import { joinWorktreeRelativePath, normalizeRuntimeRelativePath } from '../runtime-relative-paths'
import type { ResultSchemaValidation } from './workflow-result-schema'
import { createResultSchemaValidator } from './workflow-result-schema'
import type { WorkflowFilesystem } from './workflow-file-store-filesystem'

/** The `loop_*` reasons fail a Loop node: cap reached, a failed body node, or an exit never reached. */
export const WORKFLOW_RESULT_FAILURE_REASONS = [
  'result_missing',
  'result_invalid',
  'artifact_missing',
  'worker_failed',
  'loop_cap_reached',
  'loop_body_failed',
  'loop_exit_unreached'
] as const
export type WorkflowResultFailureReason = (typeof WORKFLOW_RESULT_FAILURE_REASONS)[number]

export type ArtifactSpec = { path: string; required: boolean }

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
}

/**
 * `ok: true` only when the result validates, every required artifact exists, and the worker
 * reported `succeeded`. Every failure carries a `failureReason`: `worker_failed` covers an
 * otherwise-valid result whose worker reported `outcome: 'failed'` (contracts/agent-brief.md
 * validation #4), even though no earlier validation step found a problem.
 */
export type CaptureResultOutcome =
  | { ok: true; result: JsonValue; artifacts: WorkflowAttemptArtifact[] }
  | {
      ok: false
      failureReason: WorkflowResultFailureReason
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

async function pathExists(fs: WorkflowFilesystem, absolutePath: string): Promise<boolean> {
  try {
    await fs.readFile(absolutePath)
    return true
  } catch (error) {
    if (error instanceof Error && error.message === 'workflow_file_binary') {
      return true // Binary files fail `readFile`'s SSH decode but do exist.
    }
  }
  try {
    await fs.readDir(absolutePath) // Artifacts may be directories (spec.md's Artifact glossary entry).
    return true
  } catch {
    return false
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

async function resolveArtifacts(
  fs: WorkflowFilesystem,
  workspaceRoot: string,
  specs: readonly ArtifactSpec[]
): Promise<WorkflowAttemptArtifact[]> {
  const artifacts: WorkflowAttemptArtifact[] = []
  for (const spec of specs) {
    let exists = false
    try {
      const normalized = normalizeRuntimeRelativePath(spec.path)
      exists = await pathExists(fs, joinWorktreeRelativePath(workspaceRoot, normalized))
    } catch {
      exists = false // Escapes the run workspace (absolute or `..`); never counts as present.
    }
    artifacts.push({ path: spec.path, exists })
  }
  return artifacts
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
  const artifacts = await resolveArtifacts(fs, workspaceRoot, specs)
  const existsByPath = new Map(artifacts.map((artifact) => [artifact.path, artifact.exists]))
  const missingRequired = specs.some((spec) => spec.required && !existsByPath.get(spec.path))
  if (missingRequired) {
    return { ok: false, failureReason: 'artifact_missing', result, artifacts }
  }

  if (outcome === 'failed') {
    return { ok: false, failureReason: 'worker_failed', result, artifacts }
  }

  return { ok: true, result, artifacts }
}
