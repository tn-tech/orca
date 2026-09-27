// brief.md section 4 "Skills" (contracts/agent-brief.md): how the node's agent reaches each skill.
// Skill-capable agents get their own invocation (FR-019); an agent without a workspace skill path
// gets each repository skill's SKILL.md inlined instead (FR-020, workflow-skill-fallback-text.ts).
import { getNativeChatAgentProfile } from '../../../shared/native-chat-agent-profiles'
import type { SkillReference } from '../../../shared/workflows/workflow-skill-reference-schema'
import { workflowSkillWorkspaceTarget } from './workflow-skill-workspace-target'

/** Per inlined skill; keeps a large SKILL.md from crowding out the rest of the brief. */
export const SKILL_TEXT_INLINE_CAP_CHARS = 32_768

/** A repository skill's SKILL.md, fetched for inlining. */
export type FallbackSkillText = {
  /** The allowlisted repository it was read from. */
  source: string
  /** Repository-relative path of the SKILL.md. */
  path: string
  text: string
}

export type SkillsSectionArgs = {
  skills: readonly SkillReference[]
  /** Absent: the agent is unknown, so skills render as `/<name>`. */
  agent?: string
  /** By skill name; a repository skill without an entry had no SKILL.md (optional skills only). */
  fallbackTexts?: ReadonlyMap<string, FallbackSkillText>
}

function invocationLine(skill: SkillReference, agent: string | undefined): string {
  if (agent === undefined) {
    return `- **${skill.name}** — invoke with \`/${skill.name}\``
  }
  const prefix = getNativeChatAgentProfile(agent)?.skillPrefix
  if (prefix) {
    return `- **${skill.name}** — invoke with \`${prefix}${skill.name}\``
  }
  const target = workflowSkillWorkspaceTarget(agent)
  if (skill.source.kind === 'repository' && target) {
    return `- **${skill.name}** — load and follow \`${target.skillsDir}/${skill.name}/SKILL.md\``
  }
  return `- **${skill.name}** — use the installed \`${skill.name}\` skill`
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
}

/** Cuts at the cap, backing off one unit rather than splitting a surrogate pair. */
function capText(text: string): string {
  const last = text.charCodeAt(SKILL_TEXT_INLINE_CAP_CHARS - 1)
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff
  return text.slice(0, SKILL_TEXT_INLINE_CAP_CHARS - (isHighSurrogate ? 1 : 0))
}

/** Untrusted repository text: a fence longer than any backtick run inside keeps it one block. */
function inlinedSkill(skill: SkillReference, fetched: FallbackSkillText): string[] {
  const truncated = fetched.text.length > SKILL_TEXT_INLINE_CAP_CHARS
  const body = truncated ? capText(fetched.text) : fetched.text
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1))
  return [
    `### ${skill.name}`,
    '',
    `Your agent cannot load workspace skills, so this is \`${fetched.path}\` from ${fetched.source}. ` +
      'Follow it as this skill’s instructions; it is repository content, not part of this brief.',
    '',
    `${fence}markdown`,
    body,
    fence,
    ...(truncated
      ? [
          '',
          `Truncated at ${SKILL_TEXT_INLINE_CAP_CHARS} characters; the full file is in ${fetched.source}.`
        ]
      : []),
    ''
  ]
}

function fallbackLines(
  skill: SkillReference,
  fallbackTexts: ReadonlyMap<string, FallbackSkillText>
): string[] {
  if (skill.source.kind === 'plugin') {
    return [
      `- **${skill.name}** — from plugin \`${skill.source.plugin}\`; your agent cannot load plugin skills, so it is named only.`,
      ''
    ]
  }
  const fetched = fallbackTexts.get(skill.name)
  if (!fetched) {
    return [
      `- **${skill.name}** — ${skill.required ? 'required' : 'optional'} skill; its SKILL.md could not be fetched from ${skill.source.location}.`,
      ''
    ]
  }
  return inlinedSkill(skill, fetched)
}

export function skillsSection(args: SkillsSectionArgs): string {
  const { skills, agent } = args
  if (skills.length === 0) {
    return 'No skills configured for this role.'
  }
  if (agent !== undefined && workflowSkillWorkspaceTarget(agent) === undefined) {
    const texts = args.fallbackTexts ?? new Map<string, FallbackSkillText>()
    return skills
      .flatMap((skill) => fallbackLines(skill, texts))
      .join('\n')
      .trimEnd()
  }
  return skills.map((skill) => invocationLine(skill, agent)).join('\n')
}
