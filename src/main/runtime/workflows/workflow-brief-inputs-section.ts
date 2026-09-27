// brief.md section 3 "Inputs" (contracts/agent-brief.md): upstream results and Loop context.
import type { BriefReferenceInputs } from '../../../shared/workflows/workflow-brief-references'
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'

type ResultRows = Record<string, { result: JsonValue; artifacts?: string[] }>

function resultTable(rows: ResultRows, emptyText: string): string {
  const entries = Object.entries(rows)
  if (entries.length === 0) {
    return emptyText
  }
  return [
    '| Node | Result | Artifacts |',
    '| --- | --- | --- |',
    ...entries.map(
      ([nodeId, { result, artifacts = [] }]) =>
        `| ${nodeId} | \`${JSON.stringify(result)}\` | ${artifacts.map((path) => `\`${path}\``).join(', ') || '—'} |`
    )
  ].join('\n')
}

/** Loop body nodes also see their iteration and the previous iteration's results (FR-028). */
function loopSection(inputs: BriefReferenceInputs, iteration: number | undefined): string[] {
  if (inputs.loopPrevious === undefined) {
    return []
  }
  return [
    `Loop iteration ${iteration ?? 0} (0-based). Previous iteration results (\`loop.previous\`):`,
    '',
    resultTable(inputs.loopPrevious, 'No previous iteration.'),
    ''
  ]
}

export function inputsSection(
  inputs: BriefReferenceInputs,
  iteration: number | undefined,
  inputsJsonPath: string
): string {
  return [
    resultTable(inputs.upstream, 'No upstream node results.'),
    '',
    ...loopSection(inputs, iteration),
    `Full structured data (including \`loop.previous\` and \`join.branches\` where applicable) is in \`${inputsJsonPath}\`.`
  ].join('\n')
}
