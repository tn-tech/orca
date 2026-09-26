import { isDeepStrictEqual } from 'node:util'
import { parse as parseYaml } from 'yaml'
import type { Role, Workflow } from '../../../shared/workflows/workflow-definition-types'
import { RoleFileSchema } from '../../../shared/workflows/workflow-definition-schema'
import { isENOENT } from '../../ipc/filesystem-auth'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { RoleFetchHost } from './workflow-role-fetch-host'
import {
  isWorkflowSourceAllowed,
  normalizeWorkflowSourceUrl,
  WORKFLOW_SOURCE_NOT_ALLOWED_CODE
} from './workflow-source-allowlist'

/** A role repository holds each role at `roles/<roleName>.role.yaml`, in the Role file shape. */
export const ROLE_FILE_DIRECTORY = 'roles'
export const ROLE_FILE_SUFFIX = '.role.yaml'
const CHECKOUT_DIR_NAME = 'repo'
const ROLE_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

type RoleContent = Omit<Role, 'id' | 'origin'>

export type RoleImportRequest = { source: string; roleName: string; version?: string }

export type FetchedRole = {
  roleId: string
  source: string
  /** The exact commit the role file was read at, so a re-import can tell upstream moved. */
  version: string
  importedAt: string
  content: RoleContent
}

/** FR-015a: the role source, or one of the role's repository skill sources, is not allowlisted. */
export class RoleSourceNotAllowedError extends Error {
  constructor(readonly source: string) {
    super(WORKFLOW_SOURCE_NOT_ALLOWED_CODE)
    this.name = 'RoleSourceNotAllowedError'
  }
}

function assertValidRoleName(roleName: string): void {
  if (!ROLE_NAME_PATTERN.test(roleName) || roleName.includes('..')) {
    throw new OrchestrationError('workflow_role_name_invalid', 'workflow_role_name_invalid', {
      roleName
    })
  }
}

function parseRoleFile(raw: string, roleName: string): RoleContent {
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch (error) {
    throw new OrchestrationError(
      'workflow_role_invalid',
      `Role file for "${roleName}" is not valid YAML: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const result = RoleFileSchema.safeParse(parsed)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new OrchestrationError(
      'workflow_role_invalid',
      `Role file for "${roleName}" is invalid: ${detail}`
    )
  }
  // An upstream file's own origin is meaningless here; the importer writes a fresh one.
  const { origin: _origin, ...content } = result.data
  return content
}

function assertRoleSkillSourcesAllowed(content: RoleContent, allowlist: readonly string[]): void {
  for (const skill of content.skills) {
    if (
      skill.source.kind === 'repository' &&
      !isWorkflowSourceAllowed(skill.source.location, allowlist)
    ) {
      throw new RoleSourceNotAllowedError(skill.source.location)
    }
  }
}

async function readRoleFileFromCheckout(
  host: RoleFetchHost,
  checkoutDir: string,
  roleName: string
): Promise<string> {
  const relativePath = `${ROLE_FILE_DIRECTORY}/${roleName}${ROLE_FILE_SUFFIX}`
  try {
    return await host.readFile(host.joinPath(checkoutDir, relativePath))
  } catch (error) {
    if (isENOENT(error)) {
      throw new OrchestrationError('workflow_role_not_found', 'workflow_role_not_found', {
        roleName,
        path: relativePath
      })
    }
    throw error
  }
}

/**
 * Checks the source against the project allowlist, shallow-clones it on the execution host into a
 * temp dir (always removed), and reads `roles/<roleName>.role.yaml`. Also refuses a role that
 * names a non-allowlisted repository skill, since importing it would smuggle that source in.
 */
export async function fetchRoleForImport(
  request: RoleImportRequest,
  deps: { host: RoleFetchHost; allowlist: readonly string[]; now: Date }
): Promise<FetchedRole> {
  assertValidRoleName(request.roleName)
  if (!isWorkflowSourceAllowed(request.source, deps.allowlist)) {
    throw new RoleSourceNotAllowedError(request.source)
  }
  const { host } = deps
  const tempDir = await host.createTempDir()
  try {
    const cloneArgs = ['clone', '--quiet', '--depth', '1']
    if (request.version) {
      cloneArgs.push('--branch', request.version)
    }
    cloneArgs.push('--', request.source, CHECKOUT_DIR_NAME)
    await host.runGit(cloneArgs, tempDir)
    const checkoutDir = host.joinPath(tempDir, CHECKOUT_DIR_NAME)
    const version = (await host.runGit(['rev-parse', 'HEAD'], checkoutDir)).trim()
    const raw = await readRoleFileFromCheckout(host, checkoutDir, request.roleName)
    const content = parseRoleFile(raw, request.roleName)
    assertRoleSkillSourcesAllowed(content, deps.allowlist)
    return {
      roleId: request.roleName,
      source: request.source,
      version,
      importedAt: deps.now.toISOString(),
      content
    }
  } finally {
    await host.removeDir(tempDir).catch(() => {})
  }
}

function roleContentOf(role: Role): RoleContent {
  const { id: _id, origin: _origin, ...content } = role
  return content
}

// Why: an absent optional field and one present as `undefined` are the same role content.
function isSameRoleContent(a: RoleContent, b: RoleContent): boolean {
  return isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)))
}

function isSameSource(a: string, b: string): boolean {
  return normalizeWorkflowSourceUrl(a) === normalizeWorkflowSourceUrl(b)
}

/**
 * Re-import takes upstream unless the local copy carries edits, which are kept and flagged
 * `localModified` against the newly imported version. A local edit is evident when the role is
 * already flagged, was not imported from this source, or differs at the same upstream commit.
 */
export function applyImportedRole(existing: Role | undefined, fetched: FetchedRole): Role {
  const origin = {
    source: fetched.source,
    version: fetched.version,
    importedAt: fetched.importedAt
  }
  const upstream: Role = {
    id: fetched.roleId,
    ...fetched.content,
    origin: { ...origin, localModified: false }
  }
  if (!existing || isSameRoleContent(roleContentOf(existing), fetched.content)) {
    return upstream
  }
  const upstreamMovedUnderUneditedCopy =
    existing.origin !== undefined &&
    !existing.origin.localModified &&
    isSameSource(existing.origin.source, fetched.source) &&
    existing.origin.version !== fetched.version
  if (upstreamMovedUnderUneditedCopy) {
    return upstream
  }
  return { ...existing, id: fetched.roleId, origin: { ...origin, localModified: true } }
}

/** Copies the fetched role into `definition.roles` under its role id. */
export function withImportedRole(
  definition: Workflow,
  fetched: FetchedRole
): { definition: Workflow; role: Role } {
  const role = applyImportedRole(definition.roles[fetched.roleId], fetched)
  return {
    definition: { ...definition, roles: { ...definition.roles, [fetched.roleId]: role } },
    role
  }
}
