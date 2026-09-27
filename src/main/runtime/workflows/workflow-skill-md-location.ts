// Where `skills add <repo> --skill <name>` finds a skill in a cloned repository, so the prompt
// fallback inlines the SKILL.md an install would place. A port of the skills CLI 1.7.0 clone path,
// `discoverSkills` then `filterSkills`, run over the checkout's tracked files (`git ls-files`).
// The CLI's GitHub blob fast path (`findSkillMdPaths`) serves only a few GitHub owners, so it is
// not ported; a skill's `subpath` and `--full-depth` are never passed by Orca's installs.
import { parse as parseYaml } from 'yaml'
import {
  joinCheckoutPath,
  lockedSkillNames,
  normalizeLockedSkillName,
  pluginSkillSearchDirs,
  type SkillRepositoryCheckout
} from './workflow-skill-repository-manifests'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__'])
const AGENT_PROJECT_SKILL_DIRS = [
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
].map((dir) => `${dir}/skills`)
const CONTAINER_DIRS = [
  'skills',
  'skills/.curated',
  'skills/.experimental',
  'skills/.system',
  ...AGENT_PROJECT_SKILL_DIRS
]
const CONTAINER_WALK_DEPTH = 3
const FALLBACK_MAX_DEPTH = 5

/** Frontmatter `name`, only when `name` and `description` are both non-empty strings. */
export function skillMdName(raw: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) {
    return undefined
  }
  let data: unknown
  try {
    data = parseYaml(match[1] ?? '')
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null || !('name' in data) || !('description' in data)) {
    return undefined
  }
  const { name, description } = data
  if (typeof name !== 'string' || typeof description !== 'string' || !name || !description) {
    return undefined
  }
  return name.replace(/[\r\n]+/g, ' ').trim()
}

/** Immediate child dirs of every dir in the checkout, sorted as `git ls-files` lists them. */
function childDirs(paths: readonly string[]): Map<string, string[]> {
  const children = new Map<string, Set<string>>()
  for (const path of paths) {
    const segments = path.split('/')
    for (let index = 0; index < segments.length - 1; index++) {
      const dir = segments.slice(0, index).join('/')
      children.set(dir, (children.get(dir) ?? new Set()).add(segments[index] ?? ''))
    }
  }
  return new Map([...children].map(([dir, names]) => [dir, [...names].sort()]))
}

function skillMdPath(dir: string): string {
  return dir === '' ? 'SKILL.md' : `${dir}/SKILL.md`
}

export type LocatedSkillMd = { path: string; text: string }

/** The SKILL.md `skills add --skill <name>` would install from this checkout, if any. */
export async function locateSkillMd(
  checkout: SkillRepositoryCheckout,
  name: string
): Promise<LocatedSkillMd | undefined> {
  const files = new Set(checkout.paths)
  const children = childDirs(checkout.paths)
  const locked = await lockedSkillNames(checkout)
  const wanted = name.toLowerCase()
  const parsedPaths = new Set<string>()
  const seenNames = new Set<string>()
  let match: LocatedSkillMd | undefined

  const isInstalledCopy = (dir: string, skillName: string): boolean =>
    locked.size > 0 &&
    AGENT_PROJECT_SKILL_DIRS.some((root) => dir === root || dir.startsWith(`${root}/`)) &&
    (locked.has(normalizeLockedSkillName(skillName)) ||
      locked.has(normalizeLockedSkillName(dir.split('/').at(-1) ?? '')))

  /** CLI `tryAddSkillAt`: `true` whenever the dir holds a SKILL.md, valid or not. */
  const tryAddSkillAt = async (dir: string): Promise<boolean> => {
    const path = skillMdPath(dir)
    if (!files.has(path)) {
      return false
    }
    if (parsedPaths.has(path)) {
      return true
    }
    parsedPaths.add(path)
    const text = await checkout.readText(path)
    const skillName = text === null ? undefined : skillMdName(text)
    if (text === null || skillName === undefined || seenNames.has(skillName)) {
      return true
    }
    if (isInstalledCopy(dir, skillName)) {
      return true
    }
    seenNames.add(skillName)
    if (skillName.toLowerCase() === wanted) {
      match ??= { path, text }
    }
    return true
  }

  const walk = async (dir: string, maxDepth: number, depth = 1): Promise<void> => {
    for (const child of children.get(dir) ?? []) {
      const childDir = dir === '' ? child : `${dir}/${child}`
      const holdsSkill = await tryAddSkillAt(childDir)
      if (match) {
        return
      }
      if (!holdsSkill && depth < maxDepth && !SKIP_DIRS.has(child)) {
        await walk(childDir, maxDepth, depth + 1)
      }
    }
  }

  // A valid root skill is the only skill the CLI returns.
  if (files.has('SKILL.md')) {
    await tryAddSkillAt('')
    if (seenNames.size > 0) {
      return match
    }
  }
  const deepDirs = new Set(CONTAINER_DIRS)
  for (const dir of ['', ...CONTAINER_DIRS, ...(await pluginSkillSearchDirs(checkout))]) {
    await walk(joinCheckoutPath(dir) ?? dir, deepDirs.has(dir) ? CONTAINER_WALK_DEPTH : 1)
    if (match) {
      return match
    }
  }
  if (seenNames.size > 0) {
    return undefined
  }
  // CLI `findSkillDirs`: every dir up to five levels down, parent before children.
  const fallback = async (dir: string, depth: number): Promise<void> => {
    if (depth > FALLBACK_MAX_DEPTH || match) {
      return
    }
    await tryAddSkillAt(dir)
    for (const child of (children.get(dir) ?? []).filter((name) => !SKIP_DIRS.has(name))) {
      await fallback(dir === '' ? child : `${dir}/${child}`, depth + 1)
    }
  }
  await fallback('', 0)
  return match
}
