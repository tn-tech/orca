// Picks the skill-provisioning wiring for a run workspace's execution host. Only local workspaces
// install today; SSH and WSL workspaces are refused so nothing is ever installed on the wrong
// machine (ssh-execution-boundary.md) — U39 plugs their ports into `hostProvisioningPorts`.
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { runProcess } from '../../../shared/child-process/run-process'
import {
  resolveCliCommand,
  withCliRuntimeOnPath
} from '../../../shared/node-cli-command-resolution'
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'
import { parseWslUncPath } from '../../../shared/wsl-paths'
import { gitExecFileAsync } from '../../git/runner'
import { isENOENT } from '../../ipc/filesystem-auth'
import { joinWorktreeRelativePath } from '../runtime-relative-paths'
import type { OrcaIgnoreTarget } from './workflow-brief-builder'
import { getRepoWorkflowSourceAllowlist } from './workflow-source-allowlist'
import {
  provisionNodeSkills,
  releaseRunSkillInstalls,
  type WorkflowSkillFilesystem,
  type WorkflowSkillProvisioningOutcome,
  type WorkflowSkillProvisioningPorts
} from './workflow-skill-provisioning'

export const localWorkflowSkillFilesystem: WorkflowSkillFilesystem = {
  async exists(path) {
    try {
      // lstat: the skills CLI links agent dirs to the canonical copy; the link itself counts.
      await lstat(path)
      return true
    } catch (error) {
      if (isENOENT(error)) {
        return false
      }
      throw error
    }
  },
  async readText(path) {
    try {
      return await readFile(path, 'utf-8')
    } catch (error) {
      if (isENOENT(error)) {
        return null
      }
      throw error
    }
  },
  async writeText(path, content) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf-8')
  },
  async removePath(path) {
    await rm(path, { recursive: true, force: true })
  }
}

/** `git rev-parse --git-path` (Git 2.5+) finds the common-dir exclude file from a linked worktree. */
async function resolveLocalGitExcludePath(workspaceRoot: string): Promise<string | null> {
  if (!(await localWorkflowSkillFilesystem.exists(join(workspaceRoot, '.git')))) {
    return null
  }
  const { stdout } = await gitExecFileAsync(['rev-parse', '--git-path', 'info/exclude'], {
    cwd: workspaceRoot
  })
  return resolve(workspaceRoot, stdout.trim())
}

// Placeholders until the plugin installer and trust store land (U40): nothing reads as
// installed and nothing is trusted, so a plugin skill never installs without a decision.
const pendingPluginPorts: Pick<WorkflowSkillProvisioningPorts, 'plugins' | 'trust'> = {
  plugins: {
    isInstalled: async () => false,
    install: async () => ({ ok: false, reason: 'Plugin installs are not available yet.' })
  },
  trust: { decide: async () => 'needs-question' }
}

type CleanupPorts = Pick<WorkflowSkillProvisioningPorts, 'fs' | 'resolveGitExcludePath'>

type HostProvisioningPorts = {
  cleanup: CleanupPorts
  /** Lazy: resolving npx scans PATH, which cleanup never needs. */
  install(): WorkflowSkillProvisioningPorts
}

const localCleanupPorts: CleanupPorts = {
  fs: localWorkflowSkillFilesystem,
  resolveGitExcludePath: resolveLocalGitExcludePath
}

const localHostPorts: HostProvisioningPorts = {
  cleanup: localCleanupPorts,
  install() {
    const npxCommand = resolveCliCommand('npx')
    return {
      runProcess,
      npxCommand,
      // Why: npx is a node script; without its own node first on PATH it can load under another.
      npxEnv: withCliRuntimeOnPath(npxCommand, { ...process.env }),
      ...localCleanupPorts,
      ...pendingPluginPorts
    }
  }
}

type RunWorkspaceHost = {
  workspaceRoot: string
  orcaIgnoreTarget: Pick<OrcaIgnoreTarget, 'host' | 'repoPath'>
}

/** `undefined` for hosts this unit does not provision on; never falls back to local. */
function hostProvisioningPorts(workspace: RunWorkspaceHost): HostProvisioningPorts | undefined {
  if (workspace.orcaIgnoreTarget.host !== 'local' || parseWslUncPath(workspace.workspaceRoot)) {
    return undefined
  }
  return localHostPorts
}

export type RunSkillProvisioner = {
  provision(request: {
    runId: string
    agent: string
    skills: readonly SkillReference[]
  }): Promise<WorkflowSkillProvisioningOutcome>
  release(runId: string): Promise<void>
}

export function createRunSkillProvisioner(workspace: RunWorkspaceHost): RunSkillProvisioner {
  const hostPorts = hostProvisioningPorts(workspace)
  const { workspaceRoot } = workspace
  const repoPath = workspace.orcaIgnoreTarget.repoPath
  return {
    async provision({ runId, agent, skills }) {
      if (skills.length === 0) {
        return { kind: 'ready', installed: [] }
      }
      if (!hostPorts) {
        return {
          kind: 'failed',
          reason:
            'Skills cannot be provisioned on this workspace host yet. Orca installs skills only ' +
            'on the machine that runs the node, so nothing was installed.'
        }
      }
      const readAllowlist = async () => ({
        sources: await getRepoWorkflowSourceAllowlist({ path: repoPath }),
        location: joinWorktreeRelativePath(repoPath, 'orca.yaml')
      })
      const input = { runId, agent, skills, workspaceRoot, readAllowlist }
      return provisionNodeSkills(input, hostPorts.install())
    },
    async release(runId) {
      if (!hostPorts) {
        return
      }
      try {
        await releaseRunSkillInstalls({ runId, workspaceRoot }, hostPorts.cleanup)
      } catch (error) {
        console.warn(
          `[workflow-skills] Could not clean up skills installed for run ${runId}`,
          error
        )
      }
    }
  }
}
