// The change bundle a role proposal exports toward its origin repository (US7 AS3): a patch to the
// origin's `roles/<roleId>.role.yaml` plus a README describing the contribution flow.
import { isMap, parseDocument, stringify } from 'yaml'
import type { Role } from '../../../shared/workflows/workflow-definition-types'
import type {
  RoleProposalChange,
  RoleProposalView
} from '../../../shared/workflows/workflow-run-types'
import { ROLE_FILE_DIRECTORY, ROLE_FILE_SUFFIX } from './workflow-role-import'
import { roleContentOf } from './workflow-role-import-merge'
import { applyRoleProposalChange } from './workflow-role-proposal-apply'

const CONTEXT_LINES = 3

export type RoleProposalBundle = { patch: string; readme: string }

type RoleOrigin = NonNullable<Role['origin']>

/** A role as its origin repository stores it (workflow-role-import.ts reads this shape back). */
function roleFileText(role: Role): string {
  return stringify(roleContentOf(role))
}

function splitLines(text: string): string[] {
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n')
}

function hunkRange(start: number, count: number): string {
  return count === 0 ? `${start},0` : `${start + 1},${count}`
}

/** One-hunk unified diff between two newline-terminated texts, `git apply`-able from the repo root. */
export function unifiedFileDiff(path: string, before: string, after: string): string {
  const a = splitLines(before)
  const b = splitLines(after)
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const start = Math.max(0, prefix - CONTEXT_LINES)
  const lead = a.slice(start, prefix)
  const removed = a.slice(prefix, a.length - suffix)
  const added = b.slice(prefix, b.length - suffix)
  const trail = a.slice(a.length - suffix, a.length - suffix + Math.min(suffix, CONTEXT_LINES))
  const oldCount = lead.length + removed.length + trail.length
  const newCount = lead.length + added.length + trail.length
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${hunkRange(start, oldCount)} +${hunkRange(start, newCount)} @@`,
    ...lead.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...trail.map((line) => ` ${line}`),
    ''
  ].join('\n')
}

/** A fence longer than any backtick run in `text`, so the text cannot close it early. */
function codeFence(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longestRun + 1))
}

/** Replaces only the changed keys, keeping the file's comments, key order and scalar styles. */
function applyChangeToRoleText(text: string, change: RoleProposalChange): string | undefined {
  const doc = parseDocument(text)
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    return undefined
  }
  if (change.systemPrompt !== undefined) {
    doc.set('systemPrompt', change.systemPrompt)
  }
  if (change.skills !== undefined) {
    doc.set('skills', doc.createNode(change.skills))
  }
  return doc.toString()
}

/** `origin`: diffed against the origin's own file; `orca-format`: against Orca's serialization. */
type PatchBase = 'origin' | 'orca-format'

function baseLines(base: PatchBase, origin: RoleOrigin, roleFilePath: string): string[] {
  if (base === 'origin') {
    return [`The patch is against \`${roleFilePath}\` as it is at ${origin.version}.`]
  }
  return [
    'The origin repository could not be read, so this patch assumes the role file is formatted ' +
      `exactly as Orca writes it. If \`git apply\` refuses it, edit \`${roleFilePath}\` to ` +
      'match the proposed role file below.',
    ...(origin.localModified
      ? [
          '',
          "This workflow's copy of the role was changed locally after it was imported, so the " +
            `patch is against that copy and may not apply to ${origin.version} as is.`
        ]
      : [])
  ]
}

function readmeText(args: {
  workflowName: string
  runId: string
  roleId: string
  role: Role
  origin: RoleOrigin
  roleFilePath: string
  evidence: string
  proposedFile: string
  base: PatchBase
}): string {
  const { origin, roleId } = args
  const fence = codeFence(args.proposedFile)
  return [
    `# Proposed change to role "${roleId}"`,
    '',
    `A Reflection node in workflow "${args.workflowName}" (run ${args.runId}) proposed this ` +
      `change to the role "${args.role.name}", imported from ${origin.source} at ${origin.version}.`,
    '',
    ...baseLines(args.base, origin, args.roleFilePath),
    '',
    '## Evidence',
    '',
    args.evidence,
    '',
    '## Contribute it to the origin repository',
    '',
    `\`${roleId}.patch\` (next to this file) changes \`${args.roleFilePath}\`.`,
    '',
    `1. Clone ${origin.source} and create a branch from ${origin.version} (or from its ` +
      'current default branch).',
    `2. From the repository root, run \`git apply <path to>/${roleId}.patch\`. If it no longer ` +
      `applies, edit \`${args.roleFilePath}\` to match the proposed file below.`,
    '3. Commit, push the branch, and open a pull request or merge request the way the ' +
      "repository's own contribution guide (for example its CONTRIBUTING file) describes.",
    '',
    '## Proposed role file',
    '',
    `${fence}yaml`,
    args.proposedFile.trimEnd(),
    fence,
    ''
  ].join('\n')
}

/**
 * `originText` is the role file as the origin holds it (workflow-role-origin-text.ts); without
 * it, or when it does not parse, the patch is against Orca's serialization of `role`.
 */
export function buildRoleProposalBundle(args: {
  workflowName: string
  runId: string
  role: Role
  origin: RoleOrigin
  proposal: Pick<RoleProposalView, 'roleId' | 'change' | 'evidence'>
  originText?: string
}): RoleProposalBundle {
  const { proposal, role } = args
  const roleFilePath = `${ROLE_FILE_DIRECTORY}/${proposal.roleId}${ROLE_FILE_SUFFIX}`
  const fromOrigin =
    args.originText === undefined
      ? undefined
      : applyChangeToRoleText(args.originText, proposal.change)
  const [base, before, after]: [PatchBase, string, string] =
    args.originText !== undefined && fromOrigin !== undefined
      ? ['origin', args.originText, fromOrigin]
      : [
          'orca-format',
          roleFileText(role),
          roleFileText(applyRoleProposalChange(role, proposal.change))
        ]
  return {
    patch: unifiedFileDiff(roleFilePath, before, after),
    readme: readmeText({
      workflowName: args.workflowName,
      runId: args.runId,
      roleId: proposal.roleId,
      role,
      origin: args.origin,
      roleFilePath,
      evidence: proposal.evidence,
      proposedFile: after,
      base
    })
  }
}
