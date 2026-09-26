// Writes each node attempt's brief.md/inputs.json and builds its taskSpec pointer
// (contracts/agent-brief.md, the authoritative section order and file shapes).
import type {
  AgentNode,
  ReflectionNode,
  ResultContract,
  RouterNode
} from '../../../shared/workflows/workflow-definition-types'
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { SkillReference } from '../../../shared/workflows/workflow-skill-reference-schema'
import type { WorkflowProblem } from '../../../shared/workflows/workflow-problem'
import {
  resolveBriefReferences,
  type BriefReferenceInputs
} from '../../../shared/workflows/workflow-brief-references'
import type { IFilesystemProvider } from '../../providers/types'
import { ensureOrcaDirIgnored } from '../../issue-command-file'
import { joinWorktreeRelativePath } from '../runtime-relative-paths'
import { ensureRemoteOrcaDirIgnored } from '../runtime-repository-issue-command'
import type { WorkflowFilesystem } from './workflow-file-store-filesystem'
import { routerChoiceLines, routerResultContract } from './workflow-router'

/** A brief-eligible node: the three role-dispatching node types (agent-brief.md). */
export type BriefNode = AgentNode | RouterNode | ReflectionNode

function attemptRelativeDir(runId: string, attemptId: string): string {
  return `.orca/workflow-runs/${runId}/${attemptId}`
}

/** Router/Reflection have no `resultContract` field; their result shape is fixed by the contract. */
export function resultContractFor(node: BriefNode): ResultContract {
  if (node.type === 'agent') {
    return node.resultContract
  }
  if (node.type === 'router') {
    return routerResultContract(node)
  }
  return {
    type: 'object',
    required: ['proposals'],
    properties: {
      proposals: {
        type: 'array',
        items: {
          type: 'object',
          required: ['roleId', 'change', 'evidence'],
          properties: {
            roleId: { type: 'string' },
            change: {
              type: 'object',
              properties: { systemPrompt: { type: 'string' }, skills: { type: 'array' } }
            },
            evidence: { type: 'string' }
          }
        }
      }
    }
  }
}

export function artifactsFor(node: BriefNode): { path: string; required: boolean }[] {
  return node.type === 'agent' ? node.artifacts : []
}

function skillsSection(skills: readonly SkillReference[]): string {
  if (skills.length === 0) {
    return 'No skills configured for this role.'
  }
  return skills.map((skill) => `- **${skill.name}** — invoke with \`/${skill.name}\``).join('\n')
}

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

function inputsSection(
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

function artifactsSection(artifacts: readonly { path: string; required: boolean }[]): string {
  if (artifacts.length === 0) {
    return 'No required artifacts.'
  }
  return artifacts
    .map((artifact) => `- \`${artifact.path}\` (${artifact.required ? 'required' : 'optional'})`)
    .join('\n')
}

export type BuildBriefMarkdownArgs = {
  workflowName: string
  runId: string
  attemptId: string
  node: BriefNode
  systemPrompt: string
  skills: readonly SkillReference[]
  briefInputs: BriefReferenceInputs
  /** The Loop iteration of a body node; shown only when `briefInputs.loopPrevious` is set. */
  iteration?: number
}

/** Renders brief.md's seven sections, in the order contracts/agent-brief.md defines them. */
export function buildBriefMarkdown(args: BuildBriefMarkdownArgs): {
  text: string
  problems: WorkflowProblem[]
} {
  const dir = attemptRelativeDir(args.runId, args.attemptId)
  const inputsJsonPath = `${dir}/inputs.json`
  const resultJsonPath = `${dir}/result.json`
  const { text: task, problems } = resolveBriefReferences(args.node.prompt, args.briefInputs)
  const resultSchema = JSON.stringify(resultContractFor(args.node), null, 2)

  const text = [
    `# Brief: ${args.node.title}`,
    `Workflow "${args.workflowName}" run ${args.runId}, attempt ${args.attemptId}.`,
    '',
    '## Role',
    '',
    args.systemPrompt,
    '',
    '## Task',
    '',
    task,
    '',
    '## Inputs',
    '',
    inputsSection(args.briefInputs, args.iteration, inputsJsonPath),
    '',
    '## Skills',
    '',
    skillsSection(args.skills),
    '',
    '## Result',
    '',
    ...(args.node.type === 'router' ? routerChoiceLines(args.node) : []),
    'The result must validate against this JSON Schema:',
    '',
    '```json',
    resultSchema,
    '```',
    '',
    `Write the result to \`${resultJsonPath}\`.`,
    '',
    '## Artifacts',
    '',
    artifactsSection(artifactsFor(args.node)),
    '',
    '## Completion',
    '',
    `Write your result to \`${resultJsonPath}\`, then send \`worker_done\` once with ` +
      `\`--report-path ${resultJsonPath}\` and \`--outcome succeeded|failed\`. Questions go ` +
      'through the coordinator `ask` command shown in the preamble; never open a local prompt.'
  ].join('\n')

  return { text, problems }
}

export type BuildInputsJsonArgs = {
  nodeId: string
  iteration: number
  objective: string
  upstream: BriefReferenceInputs['upstream']
  loopPrevious?: BriefReferenceInputs['loopPrevious']
  joinBranches?: BriefReferenceInputs['joinBranches']
}

/** inputs.json: `nodeId`/`iteration` are read by every worker (config/scripts/workflow-stub-agent.mjs). */
export function buildInputsJson(args: BuildInputsJsonArgs): Record<string, unknown> {
  return {
    nodeId: args.nodeId,
    iteration: args.iteration,
    objective: args.objective,
    upstream: args.upstream,
    ...(args.loopPrevious === undefined ? {} : { loopPrevious: args.loopPrevious }),
    ...(args.joinBranches === undefined ? {} : { joinBranches: args.joinBranches })
  }
}

export type BuildTaskSpecArgs = {
  workflowName: string
  runId: string
  attemptId: string
  nodeTitle: string
}

/** The short pointer passed to `worker-start`, kept inside the prompt budget (contracts/agent-brief.md). */
export function buildTaskSpec(args: BuildTaskSpecArgs): string {
  const dir = attemptRelativeDir(args.runId, args.attemptId)
  return [
    `Workflow "${args.workflowName}" run ${args.runId}, node "${args.nodeTitle}" (attempt ${args.attemptId}).`,
    `Read and follow ${dir}/brief.md before doing anything else.`,
    `Write your result to ${dir}/result.json and pass it as --report-path on worker_done.`
  ].join('\n')
}

export type OrcaIgnoreTarget =
  | { host: 'local'; repoPath: string }
  | { host: 'remote'; fsProvider: IFilesystemProvider; repoPath: string }

async function ensureOrcaIgnored(target: OrcaIgnoreTarget): Promise<void> {
  if (target.host === 'local') {
    ensureOrcaDirIgnored(target.repoPath)
    return
  }
  await ensureRemoteOrcaDirIgnored(target.fsProvider, target.repoPath)
}

export type WriteBriefArgs = BuildBriefMarkdownArgs & {
  fs: WorkflowFilesystem
  /** Run workspace root, host-appropriate (posix for SSH/remote, OS-native for local). */
  workspaceRoot: string
  orcaIgnoreTarget: OrcaIgnoreTarget
  iteration: number
}

export type WriteBriefResult = {
  /** Workspace-relative, matching `NodeAttemptView.briefPath`. */
  briefPath: string
  /** Workspace-relative, matching `NodeAttemptView.resultPath`. */
  resultPath: string
  taskSpec: string
  problems: WorkflowProblem[]
}

/** Writes brief.md and inputs.json under `.orca/workflow-runs/<runId>/<attemptId>/`. */
export async function writeBrief(args: WriteBriefArgs): Promise<WriteBriefResult> {
  await ensureOrcaIgnored(args.orcaIgnoreTarget)

  const dir = attemptRelativeDir(args.runId, args.attemptId)
  const dirPath = joinWorktreeRelativePath(args.workspaceRoot, dir)
  await args.fs.createDir(dirPath)

  const { text: briefText, problems } = buildBriefMarkdown(args)
  await args.fs.writeFile(
    joinWorktreeRelativePath(args.workspaceRoot, `${dir}/brief.md`),
    briefText
  )

  const inputsJson = buildInputsJson({
    nodeId: args.node.id,
    iteration: args.iteration,
    objective: args.briefInputs.objective,
    upstream: args.briefInputs.upstream,
    loopPrevious: args.briefInputs.loopPrevious,
    joinBranches: args.briefInputs.joinBranches
  })
  await args.fs.writeFile(
    joinWorktreeRelativePath(args.workspaceRoot, `${dir}/inputs.json`),
    JSON.stringify(inputsJson, null, 2)
  )

  return {
    briefPath: `${dir}/brief.md`,
    resultPath: `${dir}/result.json`,
    taskSpec: buildTaskSpec({
      workflowName: args.workflowName,
      runId: args.runId,
      attemptId: args.attemptId,
      nodeTitle: args.node.title
    }),
    problems
  }
}
