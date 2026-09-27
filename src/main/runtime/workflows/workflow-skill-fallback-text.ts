// FR-020 prompt fallback: an agent without a workspace skill path gets no install, so each of its
// repository skills' SKILL.md is read from the allowlisted repository on the execution host and
// inlined in the brief (workflow-brief-skills.ts). Reuses the role-import fetch host (U37): a temp
// clone of the matched allowlist entry, removed on every path, never falling back to local.
// Plugin skills are not fetched: they are host-scope and Claude-only (workflow-plugin-install.ts).
import type { SkillReference } from '../../../shared/workflows/workflow-skill-reference-schema'
import type { FallbackSkillText } from './workflow-brief-skills'
import { getRoleFetchHost, type RoleFetchHost } from './workflow-role-fetch-host'
import { skillMdCandidates, skillMdDeclaresName } from './workflow-skill-md-location'
import { workflowSkillWorkspaceTarget } from './workflow-skill-workspace-target'
import {
  findAllowedWorkflowSource,
  getRepoWorkflowSourceAllowlist
} from './workflow-source-allowlist'

const CHECKOUT_DIR_NAME = 'repo'
// oxlint-disable-next-line no-control-regex -- matching control characters is the point.
const UNSAFE_PATH = /[\u0000-\u001f`]/

export type FallbackSkillTextRequest = { agent: string; skills: readonly SkillReference[] }

export type FallbackSkillTextDeps = {
  allowlist: readonly string[]
  /** Resolved only once something needs fetching, so a refusal never depends on reachability. */
  getHost: () => RoleFetchHost
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isNamedDir(path: string, name: string): boolean {
  return path.split('/').at(-2)?.toLowerCase() === name.toLowerCase()
}

async function readSkillMd(
  host: RoleFetchHost,
  checkoutDir: string,
  candidates: readonly string[],
  name: string
): Promise<{ path: string; text: string } | undefined> {
  // Why: each read is a round trip on SSH, and `<name>/SKILL.md` is the usual match.
  const ordered = [...candidates].sort(
    (a, b) => Number(isNamedDir(b, name)) - Number(isNamedDir(a, name))
  )
  for (const path of ordered) {
    const text = await host.readFile(host.joinPath(checkoutDir, path))
    if (skillMdDeclaresName(text, name)) {
      return { path, text }
    }
  }
  return undefined
}

async function listSkillMdCandidates(
  host: RoleFetchHost,
  source: string,
  tempDir: string
): Promise<string[]> {
  await host.clone(source, undefined, tempDir, CHECKOUT_DIR_NAME)
  const listing = await host.runGit(['ls-files', '-z'], host.joinPath(tempDir, CHECKOUT_DIR_NAME))
  // Why: the path is echoed into the brief, so one that could break its markdown is skipped.
  const paths = listing.split('\0').filter((path) => path.length > 0 && !UNSAFE_PATH.test(path))
  return skillMdCandidates(paths)
}

async function fetchFromSource(
  host: RoleFetchHost,
  source: string,
  skills: readonly SkillReference[],
  agent: string
): Promise<Map<string, FallbackSkillText>> {
  const found = new Map<string, FallbackSkillText>()
  const tempDir = await host.createTempDir()
  try {
    let candidates: string[]
    try {
      candidates = await listSkillMdCandidates(host, source, tempDir)
    } catch (error) {
      // An optional skill that cannot be fetched does not block the node, as with installs.
      if (!skills.some((skill) => skill.required)) {
        return found
      }
      const names = skills.map((skill) => skill.name).join(', ')
      throw new Error(
        `Could not fetch skill(s) ${names} from ${source} to inline for agent "${agent}": ${errorMessage(error)}`
      )
    }
    const checkoutDir = host.joinPath(tempDir, CHECKOUT_DIR_NAME)
    for (const skill of skills) {
      const match = await readSkillMd(host, checkoutDir, candidates, skill.name)
      if (match) {
        found.set(skill.name, { source, ...match })
      } else if (skill.required) {
        throw new Error(
          `Skill "${skill.name}" has no SKILL.md in ${source} where \`skills add\` looks, so its ` +
            `instructions cannot be inlined for agent "${agent}", which cannot load workspace skills.`
        )
      }
    }
    return found
  } finally {
    await host.removeDir(tempDir).catch((error: unknown) => {
      console.warn(`[workflow-skills] failed to remove temp checkout ${tempDir}:`, error)
    })
  }
}

/** SKILL.md text by skill name; empty for an agent that loads workspace skills itself. */
export async function fetchFallbackSkillTexts(
  request: FallbackSkillTextRequest,
  deps: FallbackSkillTextDeps
): Promise<Map<string, FallbackSkillText>> {
  const texts = new Map<string, FallbackSkillText>()
  if (workflowSkillWorkspaceTarget(request.agent)) {
    return texts
  }
  const bySource = new Map<string, SkillReference[]>()
  for (const skill of request.skills) {
    if (skill.source.kind !== 'repository') {
      continue
    }
    // Why: provisioning refuses a non-allowlisted source with the structured FR-015a refusal.
    const source = findAllowedWorkflowSource(skill.source.location, deps.allowlist)
    if (source !== undefined) {
      bySource.set(source, [...(bySource.get(source) ?? []), skill])
    }
  }
  if (bySource.size === 0) {
    return texts
  }
  const host = deps.getHost()
  for (const [source, skills] of bySource) {
    for (const [name, text] of await fetchFromSource(host, source, skills, request.agent)) {
      texts.set(name, text)
    }
  }
  return texts
}

export type FallbackSkillWorkspace = {
  orcaIgnoreTarget:
    | { host: 'local'; repoPath: string }
    | { host: 'remote'; repoPath: string; connectionId: string }
}

/** The run's wiring: the allowlist and the fetch both come from the run workspace's host. */
export async function loadRunFallbackSkillTexts(
  workspace: FallbackSkillWorkspace,
  request: FallbackSkillTextRequest
): Promise<Map<string, FallbackSkillText>> {
  const needsFetch =
    !workflowSkillWorkspaceTarget(request.agent) &&
    request.skills.some((skill) => skill.source.kind === 'repository')
  if (!needsFetch) {
    return new Map()
  }
  const target = workspace.orcaIgnoreTarget
  const repo =
    target.host === 'remote'
      ? { path: target.repoPath, connectionId: target.connectionId }
      : { path: target.repoPath }
  const allowlist = await getRepoWorkflowSourceAllowlist(repo)
  return fetchFallbackSkillTexts(request, { allowlist, getHost: () => getRoleFetchHost(repo) })
}
