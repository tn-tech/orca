// FR-020 prompt fallback: an agent without a workspace skill path gets no install, so each of its
// repository skills' SKILL.md is read from the allowlisted repository on the execution host and
// inlined in the brief (workflow-brief-skills.ts). Reuses the role-import fetch host (U37): a temp
// clone of the matched allowlist entry, removed on every path, never falling back to local.
// Plugin skills are not fetched: they are host-scope and Claude-only (workflow-plugin-install.ts).
import type { SkillReference } from '../../../shared/workflows/workflow-skill-reference-schema'
import type { FallbackSkillText } from './workflow-brief-skills'
import { getRoleFetchHost, type RoleFetchHost } from './workflow-role-fetch-host'
import { isENOENT } from '../../ipc/filesystem-auth'
import { locateSkillMd } from './workflow-skill-md-location'
import type { SkillRepositoryCheckout } from './workflow-skill-repository-manifests'
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

/** Each file is read at most once per fetch: on SSH every read is a round trip. */
function cachedCheckout(
  host: RoleFetchHost,
  checkoutDir: string,
  paths: readonly string[]
): SkillRepositoryCheckout {
  const reads = new Map<string, Promise<string | null>>()
  const readText = (path: string): Promise<string | null> =>
    host.readFile(host.joinPath(checkoutDir, path)).catch((error: unknown) => {
      // The CLI skips a SKILL.md it cannot read as text; anything else (a lost host) propagates.
      if (isENOENT(error) || errorMessage(error) === 'workflow_role_file_binary') {
        return null
      }
      throw error
    })
  return {
    paths,
    readText(path) {
      const cached = reads.get(path) ?? readText(path)
      reads.set(path, cached)
      return cached
    }
  }
}

async function cloneCheckout(
  host: RoleFetchHost,
  source: string,
  tempDir: string
): Promise<SkillRepositoryCheckout> {
  await host.clone(source, undefined, tempDir, CHECKOUT_DIR_NAME)
  const checkoutDir = host.joinPath(tempDir, CHECKOUT_DIR_NAME)
  const listing = await host.runGit(['ls-files', '-z'], checkoutDir)
  // Why: the path is echoed into the brief, so one that could break its markdown is skipped.
  const paths = listing.split('\0').filter((path) => path.length > 0 && !UNSAFE_PATH.test(path))
  return cachedCheckout(host, checkoutDir, paths)
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
    let checkout: SkillRepositoryCheckout
    try {
      checkout = await cloneCheckout(host, source, tempDir)
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
    for (const skill of skills) {
      const match = await locateSkillMd(checkout, skill.name)
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
