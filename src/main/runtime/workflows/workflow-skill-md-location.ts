// Where `skills add <repo> --skill <name>` finds a skill in a repository, so the prompt fallback
// inlines the same SKILL.md an install would place. Ported from the skills CLI 1.7.0
// (`findSkillMdPaths` over the repository's file list, then a frontmatter `name` match).
import { parse as parseYaml } from 'yaml'

const PRIORITY_PREFIXES = [
  '',
  'skills/',
  'skills/.curated/',
  'skills/.experimental/',
  'skills/.system/',
  ...[
    '.agents',
    '.claude',
    '.cline',
    '.codebuddy',
    '.codex',
    '.commandcode',
    '.continue',
    '.factory',
    '.github',
    '.goose',
    '.grok',
    '.iflow',
    '.junie',
    '.kilo',
    '.kilocode',
    '.kimchi',
    '.kiro',
    '.minimax',
    '.mux',
    '.neovate',
    '.opencode',
    '.openhands',
    '.pi',
    '.posit/assistant',
    '.qoder',
    '.roo',
    '.trae',
    '.windsurf',
    '.zcode',
    '.zencoder'
  ].map((dir) => `${dir}/skills/`)
]
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__'])
const MAX_FALLBACK_SEGMENTS = 6

function isSkillMd(segment: string | undefined): boolean {
  return segment?.toLowerCase() === 'skill.md'
}

function isPriorityMatch(path: string, prefix: string, lowerPaths: ReadonlySet<string>): boolean {
  if (!path.startsWith(prefix)) {
    return false
  }
  const parts = path.slice(prefix.length).split('/')
  if (parts.length <= 2) {
    return isSkillMd(parts.at(-1))
  }
  // Container dirs also hold nested skills, but not beneath another skill.
  const dirs = parts.slice(0, -1)
  const hasAncestorSkill = dirs
    .slice(0, -1)
    .some((_, index) =>
      lowerPaths.has(`${prefix}${dirs.slice(0, index + 1).join('/')}/skill.md`.toLowerCase())
    )
  return (
    prefix !== '' &&
    parts.length <= 4 &&
    isSkillMd(parts.at(-1)) &&
    dirs.every((dir) => !SKIP_DIRS.has(dir)) &&
    !hasAncestorSkill
  )
}

/** Candidate SKILL.md paths among a repository's `/`-separated files, in the CLI's order. */
export function skillMdCandidates(repositoryPaths: readonly string[]): string[] {
  const all = repositoryPaths.filter((path) => path.toLowerCase().endsWith('skill.md'))
  const lowerPaths = new Set(all.map((path) => path.toLowerCase()))
  const ordered: string[] = []
  for (const prefix of PRIORITY_PREFIXES) {
    for (const path of all) {
      if (!ordered.includes(path) && isPriorityMatch(path, prefix, lowerPaths)) {
        ordered.push(path)
      }
    }
  }
  return ordered.length > 0
    ? ordered
    : all.filter((path) => path.split('/').length <= MAX_FALLBACK_SEGMENTS)
}

/** The CLI selects `--skill <name>` by the SKILL.md frontmatter `name`, case-insensitively. */
export function skillMdDeclaresName(raw: string, name: string): boolean {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  if (!match) {
    return false
  }
  let data: unknown
  try {
    data = parseYaml(match[1] ?? '')
  } catch {
    return false
  }
  if (typeof data !== 'object' || data === null || !('name' in data)) {
    return false
  }
  return typeof data.name === 'string' && data.name.trim().toLowerCase() === name.toLowerCase()
}
