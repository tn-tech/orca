// Picks the skill-provisioning wiring for a run workspace's execution host: local, an SSH relay,
// or a WSL distro. Each installs only on the machine that runs the node; an unreachable host
// refuses and nothing is installed anywhere else (FR-038, ssh-execution-boundary.md).
import { cp, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { runProcess } from '../../../shared/child-process/run-process'
import {
  resolveCliCommand,
  withCliRuntimeOnPath
} from '../../../shared/node-cli-command-resolution'
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'
import { parseWslUncPath } from '../../../shared/wsl-paths'
import { isENOENT } from '../../ipc/filesystem-auth'
import { joinWorktreeRelativePath } from '../runtime-relative-paths'
import { WORKFLOW_HOST_UNREACHABLE_CODE } from './workflow-run-workspace'
import { listLocalTrackedPaths, resolveLocalGitExcludePath } from './workflow-skill-local-git'
import { getRepoWorkflowSourceAllowlist } from './workflow-source-allowlist'
import {
  provisionNodeSkills,
  releaseRunSkillInstalls,
  type WorkflowSkillFilesystem,
  type WorkflowSkillProvisioningOutcome
} from './workflow-skill-provisioning'
import {
  hostContactLostOutcome,
  sshSkillHost,
  wslSkillHost,
  type SkillCleanupPorts,
  type SkillHostExtraPorts,
  type SkillHostPorts,
  type SkillHostResolution
} from './workflow-skill-provisioning-remote'

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
  },
  async copyPath(from, to) {
    await rm(to, { recursive: true, force: true })
    await mkdir(dirname(to), { recursive: true })
    await cp(from, to, { recursive: true, verbatimSymlinks: true })
  }
}

// Placeholders until the plugin installer and trust store land (U40): nothing reads as
// installed and nothing is trusted, so a plugin skill never installs without a decision.
const pendingPluginPorts: SkillHostExtraPorts = {
  plugins: {
    isInstalled: async () => false,
    install: async () => ({ ok: false, reason: 'Plugin installs are not available yet.' })
  },
  trust: { decide: async () => 'needs-question' }
}

const localCleanupPorts: SkillCleanupPorts = {
  fs: localWorkflowSkillFilesystem,
  resolveGitExcludePath: resolveLocalGitExcludePath
}

function localHostPorts(workspaceRoot: string): SkillHostPorts {
  return {
    workspaceRoot,
    cleanup: localCleanupPorts,
    install() {
      const npxCommand = resolveCliCommand('npx')
      return {
        runProcess,
        npxCommand,
        // Why: npx is a node script; without its own node first on PATH it can load under another.
        npxEnv: withCliRuntimeOnPath(npxCommand, { ...process.env }),
        ...localCleanupPorts,
        listTrackedPaths: listLocalTrackedPaths,
        ...pendingPluginPorts
      }
    },
    isReachable: () => true
  }
}

type RunWorkspaceHost = {
  workspaceRoot: string
  orcaIgnoreTarget:
    | { host: 'local'; repoPath: string }
    | { host: 'remote'; repoPath: string; connectionId: string }
}

/** Never falls back to local: a WSL path or SSH workspace gets its own host's ports or a refusal. */
function hostProvisioningPorts(workspace: RunWorkspaceHost): SkillHostResolution {
  const target = workspace.orcaIgnoreTarget
  if (target.host === 'remote') {
    return sshSkillHost(target.connectionId, workspace.workspaceRoot, pendingPluginPorts)
  }
  const wsl = parseWslUncPath(workspace.workspaceRoot)
  return wsl ? wslSkillHost(wsl, pendingPluginPorts) : localHostPorts(workspace.workspaceRoot)
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
  const host = hostProvisioningPorts(workspace)
  const target = workspace.orcaIgnoreTarget
  return {
    async provision({ runId, agent, skills }) {
      if (skills.length === 0) {
        return { kind: 'ready', installed: [] }
      }
      if ('kind' in host) {
        return host
      }
      const readAllowlist = async () => ({
        sources: await getRepoWorkflowSourceAllowlist(
          target.host === 'remote'
            ? { path: target.repoPath, connectionId: target.connectionId }
            : { path: target.repoPath }
        ),
        location: joinWorktreeRelativePath(target.repoPath, 'orca.yaml')
      })
      const input = { runId, agent, skills, workspaceRoot: host.workspaceRoot, readAllowlist }
      try {
        return await provisionNodeSkills(input, host.install())
      } catch (error) {
        if (!host.isReachable()) {
          return hostContactLostOutcome()
        }
        throw error
      }
    },
    async release(runId) {
      if ('kind' in host) {
        if (host.code === WORKFLOW_HOST_UNREACHABLE_CODE) {
          console.warn(
            `[workflow-skills] Run ${runId}'s workspace host is unreachable; skills stay`
          )
        }
        return
      }
      try {
        await releaseRunSkillInstalls({ runId, workspaceRoot: host.workspaceRoot }, host.cleanup)
      } catch (error) {
        console.warn(
          `[workflow-skills] Could not clean up skills installed for run ${runId}`,
          error
        )
      }
    }
  }
}

/** Run-end cleanup. Never throws: the run's outcome is already decided. */
export async function releaseRunSkills(
  runId: string,
  workspace: () => Promise<RunWorkspaceHost>
): Promise<void> {
  try {
    await createRunSkillProvisioner(await workspace()).release(runId)
  } catch (error) {
    console.warn(`[workflow-skills] Could not reach run ${runId}'s workspace for cleanup`, error)
  }
}
