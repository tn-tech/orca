import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrcaWorkflowsConfig } from '../../../shared/orca-yaml-hook-types'
import type { Repo } from '../../../shared/repo-types'
import { isENOENT } from '../../ipc/filesystem-auth'
import { parseOrcaYaml } from '../../hooks'
import {
  getSshFilesystemProvider,
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE
} from '../../providers/ssh-filesystem-dispatch'
import { joinWorktreeRelativePath } from '../runtime-relative-paths'

/** Default `workflows.directory` when `orca.yaml` does not override it. */
export const DEFAULT_WORKFLOWS_DIRECTORY = 'orca-workflows'

/**
 * Reads the `workflows` block of `orca.yaml` on the repo's execution host (FR-038: no local
 * fallback when an SSH host is unreachable — that throws). Returns null when `orca.yaml` is
 * missing or has no `workflows` block.
 */
export async function readRepoWorkflowsConfig(
  repo: Pick<Repo, 'path' | 'connectionId'>
): Promise<OrcaWorkflowsConfig | null> {
  if (repo.connectionId) {
    const fsProvider = getSshFilesystemProvider(repo.connectionId)
    if (!fsProvider) {
      throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
    }
    try {
      const result = await fsProvider.readFile(joinWorktreeRelativePath(repo.path, 'orca.yaml'))
      return result.isBinary ? null : (parseOrcaYaml(result.content)?.workflows ?? null)
    } catch (error) {
      if (isENOENT(error)) {
        return null
      }
      throw error
    }
  }
  try {
    const content = await readFile(join(repo.path, 'orca.yaml'), 'utf-8')
    return parseOrcaYaml(content)?.workflows ?? null
  } catch (error) {
    if (isENOENT(error)) {
      return null
    }
    throw error
  }
}

/** Effective project workflow directory: `orca.yaml`'s `workflows.directory`, or the default. */
export async function readEffectiveWorkflowsDirectory(repo: Repo): Promise<string> {
  const config = await readRepoWorkflowsConfig(repo)
  return config?.directory ?? DEFAULT_WORKFLOWS_DIRECTORY
}
