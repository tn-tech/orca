// The repository files the skills CLI 1.7.0 reads beside SKILL.md while discovering skills in a
// clone: Claude plugin manifests (`getPluginSkillPaths`) and the local `skills-lock.json`
// (`readLocalLock`). Paths are checkout-relative and `/`-separated; '' is the checkout root.

export type SkillRepositoryCheckout = {
  /** Every tracked file, checkout-relative. */
  paths: readonly string[]
  /** `null` when the file is absent or not text. */
  readText(path: string): Promise<string | null>
}

/** Normalised join; `undefined` when the result escapes the checkout (CLI `isContainedIn`). */
export function joinCheckoutPath(...parts: string[]): string | undefined {
  const out: string[] = []
  for (const segment of parts.join('/').split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (out.length === 0) {
        return undefined
      }
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join('/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Why: the CLI accepts only `./`-prefixed manifest paths.
function isValidRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('./')
}

async function readJson(checkout: SkillRepositoryCheckout, path: string): Promise<unknown> {
  if (!checkout.paths.includes(path)) {
    return undefined
  }
  const text = await checkout.readText(path)
  if (text === null) {
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Each declared skill's parent dir, then the plugin's own `skills/` dir. */
function pluginSkillDirs(pluginBase: string | undefined, skills: unknown): string[] {
  if (pluginBase === undefined) {
    return []
  }
  const dirs: string[] = []
  for (const skillPath of Array.isArray(skills) ? skills : []) {
    const skillDir = isValidRelativePath(skillPath)
      ? joinCheckoutPath(pluginBase, skillPath)
      : undefined
    if (skillDir !== undefined) {
      dirs.push(skillDir.split('/').slice(0, -1).join('/'))
    }
  }
  dirs.push(joinCheckoutPath(pluginBase, 'skills') ?? 'skills')
  return dirs
}

/** Extra priority dirs from `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`. */
export async function pluginSkillSearchDirs(checkout: SkillRepositoryCheckout): Promise<string[]> {
  const dirs: string[] = []
  const marketplace = await readJson(checkout, '.claude-plugin/marketplace.json')
  if (isRecord(marketplace)) {
    const pluginRoot = isRecord(marketplace.metadata) ? marketplace.metadata.pluginRoot : undefined
    const root = pluginRoot === undefined ? '' : isValidRelativePath(pluginRoot) ? pluginRoot : null
    const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : []
    for (const plugin of root === null ? [] : plugins.filter(isRecord)) {
      const source =
        plugin.source === undefined ? '' : isValidRelativePath(plugin.source) ? plugin.source : null
      if (root !== null && source !== null) {
        dirs.push(...pluginSkillDirs(joinCheckoutPath(root, source), plugin.skills))
      }
    }
  }
  const plugin = await readJson(checkout, '.claude-plugin/plugin.json')
  if (isRecord(plugin)) {
    dirs.push(...pluginSkillDirs('', plugin.skills))
  }
  return dirs
}

/** The CLI's `normalizeSkillName`. */
export function normalizeLockedSkillName(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, '-')
}

/** Skill names a `skills-lock.json` (version 1+) records as installed into the repository. */
export async function lockedSkillNames(checkout: SkillRepositoryCheckout): Promise<Set<string>> {
  const lock = await readJson(checkout, 'skills-lock.json')
  if (!isRecord(lock) || typeof lock.version !== 'number' || lock.version < 1) {
    return new Set()
  }
  return new Set(
    Object.keys(isRecord(lock.skills) ? lock.skills : {}).map(normalizeLockedSkillName)
  )
}
