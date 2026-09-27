// The change bundle a role proposal exports toward its origin repository (US7 AS3): a patch to the
// origin's `roles/<roleId>.role.yaml` plus a README describing the contribution flow.
import { stringify } from 'yaml'
import type { Role } from '../../../shared/workflows/workflow-definition-types'
import type { RoleProposalView } from '../../../shared/workflows/workflow-run-types'
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

function readmeText(args: {
  workflowName: string
  runId: string
  roleId: string
  role: Role
  origin: RoleOrigin
  roleFilePath: string
  evidence: string
  proposedFile: string
}): string {
  const { origin, roleId } = args
  return [
    `# Proposed change to role "${roleId}"`,
    '',
    `A Reflection node in workflow "${args.workflowName}" (run ${args.runId}) proposed this ` +
      `change to the role "${args.role.name}", imported from ${origin.source} at ${origin.version}.`,
    ...(origin.localModified
      ? [
          '',
          "This workflow's copy of the role was changed locally after it was imported, so the " +
            `patch is against that copy and may not apply to ${origin.version} as is.`
        ]
      : []),
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
    '```yaml',
    args.proposedFile.trimEnd(),
    '```',
    ''
  ].join('\n')
}

/** `role` is the imported role as the run saw it; the patch applies the proposal on top of it. */
export function buildRoleProposalBundle(args: {
  workflowName: string
  runId: string
  role: Role
  origin: RoleOrigin
  proposal: Pick<RoleProposalView, 'roleId' | 'change' | 'evidence'>
}): RoleProposalBundle {
  const { proposal, role } = args
  const roleFilePath = `${ROLE_FILE_DIRECTORY}/${proposal.roleId}${ROLE_FILE_SUFFIX}`
  const before = roleFileText(role)
  const after = roleFileText(applyRoleProposalChange(role, proposal.change))
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
      proposedFile: after
    })
  }
}
