import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Repo } from '../../../shared/repo-types'
import { gitExecFileAsync } from '../../git/runner'
import {
  getSshFilesystemProvider,
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE
} from '../../providers/ssh-filesystem-dispatch'
import { requireSshGitProvider } from '../../providers/ssh-git-dispatch'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { joinWorktreeRelativePath } from '../runtime-relative-paths'

const ROLE_FETCH_GIT_TIMEOUT_MS = 120_000
const TEMP_DIR_PREFIX = 'orca-role-import-'
// Why: relays predating fs.tempDir report no temp dir; every POSIX relay host has /tmp.
const REMOTE_TEMP_DIR_FALLBACK = '/tmp'

/** Where a role repository is cloned and read: the repo's execution host, never a stand-in. */
export type RoleFetchHost = {
  createTempDir(): Promise<string>
  /** Clones `source` (at branch/tag `version` when given) into `cwd/dirName`. */
  clone(source: string, version: string | undefined, cwd: string, dirName: string): Promise<void>
  /** Runs git and returns stdout; throws on a non-zero exit. */
  runGit(args: string[], cwd: string): Promise<string>
  readFile(filePath: string): Promise<string>
  removeDir(dirPath: string): Promise<void>
  joinPath(dirPath: string, relativePath: string): string
}

async function runLocalGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await gitExecFileAsync(args, { cwd, timeout: ROLE_FETCH_GIT_TIMEOUT_MS })
  return stdout
}

// Why: WSL repos land here too; host git clones into a host temp dir, as only the file is copied.
export const localRoleFetchHost: RoleFetchHost = {
  createTempDir: () => mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX)),
  async clone(source, version, cwd, dirName) {
    const args = ['clone', '--quiet', '--depth', '1']
    if (version) {
      args.push('--branch', version)
    }
    await runLocalGit([...args, '--', source, dirName], cwd)
  },
  runGit: runLocalGit,
  readFile: (filePath) => readFile(filePath, 'utf-8'),
  removeDir: (dirPath) => rm(dirPath, { recursive: true, force: true }),
  joinPath: joinWorktreeRelativePath
}

function sshRoleFetchHost(connectionId: string): RoleFetchHost {
  const fsProvider = getSshFilesystemProvider(connectionId)
  if (!fsProvider) {
    throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
  }
  const gitProvider = requireSshGitProvider(connectionId)
  return {
    async createTempDir() {
      const base = (await fsProvider.getTempDir?.()) ?? REMOTE_TEMP_DIR_FALLBACK
      const dir = joinWorktreeRelativePath(base, `${TEMP_DIR_PREFIX}${randomUUID()}`)
      await fsProvider.createDir(dir)
      return dir
    },
    async clone(source, version, cwd, dirName) {
      // Why: relays (including ones already deployed) accept only `clone [--progress] -- <url> <dir>`
      // and allow no checkout/fetch afterwards, so a pinned version cannot be fetched remotely.
      if (version) {
        throw new OrchestrationError(
          'workflow_role_version_unsupported',
          `Importing a role at a pinned version ("${version}") is not supported for SSH repositories; ` +
            'omit the version to import from the default branch.',
          { version }
        )
      }
      await gitProvider.exec(['clone', '--', source, dirName], cwd, {
        timeoutMs: ROLE_FETCH_GIT_TIMEOUT_MS
      })
    },
    async runGit(args, cwd) {
      const { stdout } = await gitProvider.exec(args, cwd, {
        timeoutMs: ROLE_FETCH_GIT_TIMEOUT_MS
      })
      return stdout
    },
    async readFile(filePath) {
      const result = await fsProvider.readFile(filePath)
      if (result.isBinary) {
        throw new Error('workflow_role_file_binary')
      }
      return result.content
    },
    removeDir: (dirPath) => fsProvider.deletePath(dirPath, true),
    joinPath: joinWorktreeRelativePath
  }
}

/** The repo's execution host: SSH repos fetch on the remote and never fall back to local. */
export function getRoleFetchHost(repo: Pick<Repo, 'connectionId'>): RoleFetchHost {
  return repo.connectionId ? sshRoleFetchHost(repo.connectionId) : localRoleFetchHost
}
