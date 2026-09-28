// A Reflection proposal's changed fields, rendered as a line diff against the run's own role
// snapshot (US7 AS1 "shown as a diff against the role"). Reuses `NativeChatDiffView`'s line shape
// instead of a new renderer, and the engine's own CONTEXT_LINES=3 convention
// (workflow-role-proposal-bundle.ts's `unifiedFileDiff`) so a long unchanged systemPrompt collapses
// instead of rendering in full (contracts/agent-brief.md caps `systemPrompt` at 32,000 chars).
import { translate } from '@/i18n/i18n'
import type { NativeChatDiffLine as DiffLine } from '../../../../../shared/native-chat-diff'
import type { Role } from '../../../../../shared/workflows/workflow-definition-types'
import type { RoleProposalChange } from '../../../../../shared/workflows/workflow-run-types'
import type { SkillReference } from '../../../../../shared/workflows/workflow-skill-reference-schema'

const CONTEXT_LINES = 3

function omittedLine(count: number): DiffLine {
  const text =
    count === 1
      ? translate(
          'auto.components.workflows.run-view.workflow-role-proposal-diff.unchangedLineOne',
          '… 1 unchanged line …'
        )
      : translate(
          'auto.components.workflows.run-view.workflow-role-proposal-diff.unchangedLineMany',
          '… {{count}} unchanged lines …',
          { count }
        )
  return { kind: 'meta', text }
}

function contextLines(lines: string[]): DiffLine[] {
  return lines.map((text): DiffLine => ({ kind: 'context', text }))
}

/** The lead run of common lines before the changed region: only the lines nearest the change stay
 *  visible, with a meta marker for however many were collapsed. */
function collapsedLead(lines: string[]): DiffLine[] {
  if (lines.length <= CONTEXT_LINES) {
    return contextLines(lines)
  }
  return [omittedLine(lines.length - CONTEXT_LINES), ...contextLines(lines.slice(-CONTEXT_LINES))]
}

/** The trailing run of common lines after the changed region — the mirror of `collapsedLead`. */
function collapsedTrail(lines: string[]): DiffLine[] {
  if (lines.length <= CONTEXT_LINES) {
    return contextLines(lines)
  }
  return [...contextLines(lines.slice(0, CONTEXT_LINES)), omittedLine(lines.length - CONTEXT_LINES)]
}

/**
 * Line diff between two whole-value texts (a Reflection proposal always replaces a field's value
 * whole — contracts/agent-brief.md — never a line-level patch), by trimming the common
 * prefix/suffix and marking only the middle as changed. Mirrors
 * `workflow-role-proposal-bundle.ts`'s `unifiedFileDiff` trimming, but returns display lines
 * instead of unified-diff text.
 */
export function textFieldDiffLines(before: string, after: string): DiffLine[] {
  // `''.split('\n')` is `['']`, a phantom empty line — treat a missing side as no lines at all
  // (a role with no prior value, e.g. `roleProposalFieldDiffs`'s missing-baseline case) rather
  // than showing a spurious blank del/add line.
  if (before === '' || after === '') {
    if (before === after) {
      return []
    }
    return before === ''
      ? after.split('\n').map((text): DiffLine => ({ kind: 'add', text }))
      : before.split('\n').map((text): DiffLine => ({ kind: 'del', text }))
  }
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  let prefix = 0
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const lead = beforeLines.slice(0, prefix)
  const removed = beforeLines.slice(prefix, beforeLines.length - suffix)
  const added = afterLines.slice(prefix, afterLines.length - suffix)
  const trail = beforeLines.slice(beforeLines.length - suffix)
  return [
    ...collapsedLead(lead),
    ...removed.map((text): DiffLine => ({ kind: 'del', text })),
    ...added.map((text): DiffLine => ({ kind: 'add', text })),
    ...collapsedTrail(trail)
  ]
}

/** Added/removed line counts for a diff's summary badge (`DiffLineCounts`); context/meta don't count. */
export function diffLineCounts(lines: readonly DiffLine[]): { added: number; removed: number } {
  return lines.reduce(
    (counts, line) => {
      if (line.kind === 'add') {
        counts.added += 1
      } else if (line.kind === 'del') {
        counts.removed += 1
      }
      return counts
    },
    { added: 0, removed: 0 }
  )
}

/** Review round 1: a proposal that only flips `required` (name/source unchanged) must still show
 *  as a diff, not disappear into an identical-looking line. */
function skillRequiredText(skill: SkillReference): string {
  return skill.required
    ? translate(
        'auto.components.workflows.run-view.workflow-role-proposal-diff.skillRequired',
        'required'
      )
    : translate(
        'auto.components.workflows.run-view.workflow-role-proposal-diff.skillOptional',
        'optional'
      )
}

function skillSourceText(skill: SkillReference): string {
  if (skill.source.kind === 'plugin') {
    return translate(
      'auto.components.workflows.run-view.workflow-role-proposal-diff.skillSourcePlugin',
      'plugin: {{plugin}}',
      { plugin: skill.source.plugin }
    )
  }
  return skill.source.version
    ? translate(
        'auto.components.workflows.run-view.workflow-role-proposal-diff.skillSourceRepositoryVersioned',
        '{{location}} @ {{version}}',
        { location: skill.source.location, version: skill.source.version }
      )
    : skill.source.location
}

/** One readable line per skill ("name (source)"), so a skills-list change can go through the same
 *  line-diff algorithm as a text field instead of a bespoke array differ. */
export function formatSkillReferenceLines(skills: readonly SkillReference[]): string {
  return skills
    .map((skill) =>
      translate(
        'auto.components.workflows.run-view.workflow-role-proposal-diff.skillLine',
        '{{name}} ({{source}}, {{required}})',
        {
          name: skill.name,
          source: skillSourceText(skill),
          required: skillRequiredText(skill)
        }
      )
    )
    .join('\n')
}

export type RoleProposalFieldName = 'systemPrompt' | 'skills'
export type RoleProposalFieldDiff = { field: RoleProposalFieldName; lines: DiffLine[] }

/** One diff per field the proposal actually sets (contracts/agent-brief.md: a proposal that sets
 *  neither field is invalid, so this never needs a "no changes" placeholder) — a missing baseline
 *  role diffs against an empty value rather than throwing, since a role can vanish from the
 *  workflow between the run and viewing its proposal. */
export function roleProposalFieldDiffs(
  role: Role | undefined,
  change: RoleProposalChange
): RoleProposalFieldDiff[] {
  const diffs: RoleProposalFieldDiff[] = []
  if (change.systemPrompt !== undefined) {
    diffs.push({
      field: 'systemPrompt',
      lines: textFieldDiffLines(role?.systemPrompt ?? '', change.systemPrompt)
    })
  }
  if (change.skills !== undefined) {
    diffs.push({
      field: 'skills',
      lines: textFieldDiffLines(
        formatSkillReferenceLines(role?.skills ?? []),
        formatSkillReferenceLines(change.skills)
      )
    })
  }
  return diffs
}
