import { parse as parseYaml } from 'yaml'
import type { Role } from '../../../shared/workflows/workflow-definition-types'
import { RoleFileSchema } from '../../../shared/workflows/workflow-definition-schema'
import { isENOENT } from '../../ipc/filesystem-auth'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { RoleFetchHost } from './workflow-role-fetch-host'
import {
  findAllowedWorkflowSource,
  isWorkflowSourceAllowed,
  WORKFLOW_SOURCE_NOT_ALLOWED_CODE
} from './workflow-source-allowlist'

/** A role repository holds each role at `roles/<roleName>.role.yaml`, in the Role file shape. */
export const ROLE_FILE_DIRECTORY = 'roles'
export const ROLE_FILE_SUFFIX = '.role.yaml'
const CHECKOUT_DIR_NAME = 'repo'
const ROLE_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

export type RoleContent = Omit<Role, 'id' | 'origin'>

export type RoleImportRequest = {
  source: string
  roleName: string
  /** A branch or tag name in the role repository; omitted means its default branch. */
  version?: string
}

export type FetchedRole = {
  roleId: string
  /** The allowlist entry that admitted the request, which is what was cloned. */
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

const VERSION_NOT_FOUND_PATTERN = /not found in upstream|could not find remote branch/i

async function cloneRoleRepository(
  host: RoleFetchHost,
  source: string,
  version: string | undefined,
  tempDir: string
): Promise<void> {
  try {
    await host.clone(source, version, tempDir, CHECKOUT_DIR_NAME)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (version && VERSION_NOT_FOUND_PATTERN.test(message)) {
      throw new OrchestrationError(
        'workflow_role_version_not_found',
        `Version "${version}" is not a branch or tag of ${source}.`,
        { source, version }
      )
    }
    throw error
  }
}

/**
 * Checks the source against the project allowlist, then clones it on the execution host into a
 * temp dir (always removed) and reads `roles/<roleName>.role.yaml`. Also refuses a role that
 * names a non-allowlisted repository skill, since importing it would smuggle that source in.
 * The host is resolved only after the allowlist check, so a refusal never depends on reachability.
 */
export async function fetchRoleForImport(
  request: RoleImportRequest,
  deps: { getHost: () => RoleFetchHost; allowlist: readonly string[]; now: Date }
): Promise<FetchedRole> {
  assertValidRoleName(request.roleName)
  const source = findAllowedWorkflowSource(request.source, deps.allowlist)
  if (source === undefined) {
    throw new RoleSourceNotAllowedError(request.source)
  }
  const host = deps.getHost()
  const tempDir = await host.createTempDir()
  try {
    await cloneRoleRepository(host, source, request.version, tempDir)
    const checkoutDir = host.joinPath(tempDir, CHECKOUT_DIR_NAME)
    const version = (await host.runGit(['rev-parse', 'HEAD'], checkoutDir)).trim()
    const raw = await readRoleFileFromCheckout(host, checkoutDir, request.roleName)
    const content = parseRoleFile(raw, request.roleName)
    assertRoleSkillSourcesAllowed(content, deps.allowlist)
    return {
      roleId: request.roleName,
      source,
      version,
      importedAt: deps.now.toISOString(),
      content
    }
  } finally {
    await host.removeDir(tempDir).catch((error: unknown) => {
      console.warn(`[workflow-role-import] failed to remove temp checkout ${tempDir}:`, error)
    })
  }
}
