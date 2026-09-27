// The run record a Reflection brief carries (US7, FR-034): every earlier worker attempt's brief,
// result and artifact paths plus the dispatch whose transcript `orchestration worker-read` returns.
import type { Node, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'

export type RunRecordEntry = {
  nodeId: string
  title: string
  nodeType: Node['type']
  iteration: number
  attemptIndex: number
  state: NodeAttemptView['state']
  briefPath?: string
  resultPath?: string
  artifacts: string[]
  failureReason?: string
  transcript?: { dispatchId: string }
}

const REVIEWED_NODE_TYPES: ReadonlySet<Node['type']> = new Set(['agent', 'router', 'reflection'])

/** Every worker attempt of the run so far other than `reflectionNodeId`'s own, oldest first. */
export function buildRunRecord(
  definition: Workflow,
  attempts: readonly NodeAttemptView[],
  reflectionNodeId: string
): RunRecordEntry[] {
  return attempts
    .filter(
      (attempt) =>
        attempt.nodeId !== reflectionNodeId &&
        attempt.state !== 'pending' &&
        REVIEWED_NODE_TYPES.has(attempt.nodeType)
    )
    .map((attempt) => ({
      nodeId: attempt.nodeId,
      title: definition.nodes.find((node) => node.id === attempt.nodeId)?.title ?? attempt.nodeId,
      nodeType: attempt.nodeType,
      iteration: attempt.iteration,
      attemptIndex: attempt.attemptIndex,
      state: attempt.state,
      ...(attempt.briefPath ? { briefPath: attempt.briefPath } : {}),
      ...(attempt.resultPath ? { resultPath: attempt.resultPath } : {}),
      artifacts: attempt.artifactsJson.filter((a) => a.exists).map((a) => a.path),
      ...(attempt.failureReason ? { failureReason: attempt.failureReason } : {}),
      ...(attempt.dispatchId ? { transcript: { dispatchId: attempt.dispatchId } } : {})
    }))
}

function entryLine(entry: RunRecordEntry): string {
  const parts = [
    entry.briefPath ? `brief \`${entry.briefPath}\`` : undefined,
    entry.resultPath ? `result \`${entry.resultPath}\`` : undefined,
    entry.artifacts.length > 0
      ? `artifacts ${entry.artifacts.map((path) => `\`${path}\``).join(', ')}`
      : undefined,
    entry.transcript
      ? `transcript \`orchestration worker-read --dispatch ${entry.transcript.dispatchId}\``
      : undefined,
    entry.failureReason ? `failure \`${entry.failureReason}\`` : undefined
  ].filter((part): part is string => part !== undefined)
  const heading = `**${entry.title}** (\`${entry.nodeId}\`, iteration ${entry.iteration}, ${entry.state})`
  return `- ${heading}${parts.length > 0 ? `: ${parts.join('; ')}` : ''}`
}

/** The "Run record" block of a Reflection brief's Inputs section. */
export function runRecordLines(entries: readonly RunRecordEntry[]): string[] {
  return [
    '### Run record',
    '',
    'Review how this run went from its attempts below. Paths are relative to the workspace ' +
      'root; read a transcript with the Orca CLI shown in the preamble, as listed. The same ' +
      'record is under `runRecord` in `inputs.json`.',
    '',
    ...(entries.length > 0 ? entries.map(entryLine) : ['No earlier attempts in this run.'])
  ]
}
