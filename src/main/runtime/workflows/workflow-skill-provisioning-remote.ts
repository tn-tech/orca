// Skill-provisioning ports for SSH-backed and WSL run workspaces (T095). The skills CLI, the file
// operations and the git reads all run on the workspace's own host, so the allowlist, tracked-path,
// snapshot, ledger and exclude rules hold there exactly as locally. There is no local fallback
// (FR-038, ssh-execution-boundary.md): a host that cannot be reached refuses.
//
// SSH: the skills CLI and file operations go through the relay's `agent.execNonInteractive`, which
// runs any argv on the host; `installSkillOnSshHost` only unpacks content-addressed packages and
// cannot run the CLI. Git reads go through `git.exec`, whose validator accepts both shapes as sent.
// WSL: everything runs inside the distro via `wsl.exe --exec` (wsl-command-execution.md).
import { posix } from 'node:path'
import {
  runProcess,
  type ProcessResult,
  type ProcessSpec
} from '../../../shared/child-process/run-process'
import { isWindowsAbsolutePathLike } from '../../../shared/cross-platform-path'
import { buildPosixCommandPathLookupScript } from '../../../shared/posix-command-path-lookup'
import { buildWslExecArgs, quotePosixShell } from '../../../shared/wsl-login-shell-command'
import type { WslUncPathInfo } from '../../../shared/wsl-paths'
import { getSshGitProvider } from '../../providers/ssh-git-dispatch'
import type { RemoteCommitMessageExecResult } from '../../text-generation/source-control-text-generation-types'
import { resolveWslInteropSpawnCwd } from '../../wsl-interop-spawn-directory'
import { resolveWslExecutablePath } from '../../wsl/wsl-executable-path'
import { runWslProcess } from '../../wsl/wsl-runner'
import { WORKFLOW_HOST_UNREACHABLE_CODE } from './workflow-run-workspace'
import type { PluginHostAccess } from './workflow-plugin-install'
import { skillGitReads, type SkillGitHost } from './workflow-skill-git-reads'
import { posixShellSkillFilesystem, type PosixShellRunner } from './workflow-skill-posix-filesystem'
import type {
  WorkflowSkillProvisioningOutcome,
  WorkflowSkillProvisioningPorts
} from './workflow-skill-provisioning'

export type SkillCleanupPorts = Pick<WorkflowSkillProvisioningPorts, 'fs' | 'resolveGitExcludePath'>
export type SkillHostExtraPorts = Pick<WorkflowSkillProvisioningPorts, 'plugins' | 'trust'>
/** Builds the plugin and trust ports once the host's own CLI and file access exist. */
export type SkillHostExtras = (host: PluginHostAccess) => SkillHostExtraPorts

export type SkillHostPorts = {
  /** The workspace root as its host names it: the guest path inside WSL. */
  workspaceRoot: string
  cleanup: SkillCleanupPorts
  /** Lazy: resolving a local npx scans PATH, which cleanup never needs. */
  install(): WorkflowSkillProvisioningPorts
  /** `false` once the connection this install used is gone or replaced: contact was lost. */
  isReachable(): boolean
}

type SkillHostFailure = Extract<WorkflowSkillProvisioningOutcome, { kind: 'failed' }>
export type SkillHostResolution = SkillHostPorts | SkillHostFailure

// Why a named lane: the relay cancels an in-flight exec when its cwd+operation lane is reused.
const SKILL_EXEC_OPERATION = 'workflow-skills'
const HOST_FILE_TIMEOUT_MS = 30_000
const HOST_GIT_TIMEOUT_MS = 60_000

export function hostUnreachableOutcome(): SkillHostFailure {
  return {
    kind: 'failed',
    code: WORKFLOW_HOST_UNREACHABLE_CODE,
    reason:
      "The workspace's SSH host cannot be reached, so its skills were not provisioned. " +
      'Orca installs skills only on the machine that runs the node, so nothing was installed.'
  }
}

/** Contact dropped mid-install: what the host holds now cannot be observed (never "nothing"). */
export function hostContactLostOutcome(): SkillHostFailure {
  return {
    kind: 'failed',
    code: WORKFLOW_HOST_UNREACHABLE_CODE,
    reason:
      "Orca lost contact with the workspace's SSH host during the skill install, so the host's " +
      'state is unverifiable and partial files may remain. The next run or cleanup in this ' +
      'workspace rolls them back once the host is reachable.'
  }
}

/** `$HOME` as the host's own shell sees it, read once per install. */
function posixHomeDir(sh: PosixShellRunner): () => Promise<string> {
  let home: Promise<string> | undefined
  return () => {
    home ??= sh('printf "%s" "$HOME"', []).then((result) => {
      if (result.code !== 0 || !result.stdout.startsWith('/')) {
        throw new Error('Could not read $HOME on the workspace host.')
      }
      return result.stdout
    })
    return home
  }
}

function posixGitHost(
  fs: WorkflowSkillProvisioningPorts['fs'],
  runGit: SkillGitHost['runGit']
): SkillGitHost {
  return {
    hasGitEntry: (workspaceRoot) => fs.exists(posix.join(workspaceRoot, '.git')),
    runGit,
    resolvePath: (workspaceRoot, gitPath) => posix.resolve(workspaceRoot, gitPath)
  }
}

function fromRelayExec(result: RemoteCommitMessageExecResult): ProcessResult {
  return {
    // A canceled or unspawnable exec reported no exit, so it is never a success.
    code: result.canceled || result.spawnError ? null : result.exitCode,
    signal: null,
    stdout: result.stdout,
    stderr: [result.stderr, result.spawnError].filter(Boolean).join('\n'),
    timedOut: result.timedOut
  }
}

export function sshSkillHost(
  connectionId: string,
  workspaceRoot: string,
  extras: SkillHostExtras
): SkillHostResolution {
  if (isWindowsAbsolutePathLike(workspaceRoot)) {
    return {
      kind: 'failed',
      reason:
        'Skills cannot be provisioned on a Windows SSH host yet: installing needs a POSIX shell ' +
        'on the host, so nothing was installed.'
    }
  }
  const provider = getSshGitProvider(connectionId)
  if (!provider) {
    return hostUnreachableOutcome()
  }
  const exec = async (spec: ProcessSpec): Promise<ProcessResult> =>
    fromRelayExec(
      await provider.execNonInteractiveOperation({
        binary: spec.program,
        args: [...(spec.args ?? [])],
        cwd: spec.cwd ?? workspaceRoot,
        timeoutMs: spec.timeoutMs ?? HOST_FILE_TIMEOUT_MS,
        // Relays older than operation lanes ignore this and use the cwd's default lane.
        operation: SKILL_EXEC_OPERATION,
        ...(spec.input === undefined ? {} : { stdin: spec.input })
      })
    )
  const sh: PosixShellRunner = (script, args, input) =>
    exec({ program: '/bin/sh', args: ['-c', script, 'sh', ...args], input })
  const fs = posixShellSkillFilesystem(sh)
  const git = skillGitReads(
    posixGitHost(fs, async (args, cwd) => {
      const { stdout } = await provider.exec(args, cwd, { timeoutMs: HOST_GIT_TIMEOUT_MS })
      return stdout
    })
  )
  const cleanup = { fs, resolveGitExcludePath: git.resolveGitExcludePath }
  return {
    workspaceRoot,
    cleanup,
    // Why no npxEnv: the relay starts the CLI with the host's own environment, never ours.
    install: () => ({
      runProcess: exec,
      npxCommand: 'npx',
      ...cleanup,
      ...git,
      ...extras({ runCli: exec, fs, homeDir: posixHomeDir(sh), pathApi: posix, workspaceRoot })
    }),
    // A reconnect registers a new provider; the one this install spoke to is gone either way.
    isReachable: () => getSshGitProvider(connectionId) === provider
  }
}

function fromWslRun(result: {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}): ProcessResult {
  const { code, stdout, stderr, timedOut } = result
  return { code, signal: null, stdout, stderr, timedOut }
}

/** Runs `program` from the distro's login PATH, skipping Windows drives mounted into the guest. */
function wslLoginPathLaunchScript(program: string): string {
  return [
    buildPosixCommandPathLookupScript(
      { kind: 'literal', value: program },
      { skipWindowsMountDirs: true }
    ),
    'if [ -z "$resolved" ]; then',
    `  printf '%s\\n' ${quotePosixShell(`${program} was not found on the WSL login PATH.`)} >&2`,
    '  exit 127',
    'fi',
    'exec "$resolved" "$@"'
  ].join('\n')
}

export function wslSkillHost(wsl: WslUncPathInfo, extras: SkillHostExtras): SkillHostPorts {
  const { distro, linuxPath } = wsl
  // Why plain `sh -c`, not the login shell: coreutils need no user PATH, and a non-login shell
  // prints no rc/motd banner into the stdout `readText` returns.
  const sh: PosixShellRunner = (script, args, input) =>
    runProcess({
      program: resolveWslExecutablePath(),
      args: buildWslExecArgs(distro, ['sh', '-c', script, 'sh', ...args]),
      cwd: resolveWslInteropSpawnCwd(),
      env: { ...process.env, WSL_UTF8: '1' },
      timeoutMs: HOST_FILE_TIMEOUT_MS,
      ...(input === undefined ? {} : { input })
    })
  const fs = posixShellSkillFilesystem(sh)
  const git = skillGitReads(
    posixGitHost(fs, async (args, cwd) => {
      const result = await runWslProcess({
        distro,
        program: 'git',
        args,
        cwd,
        loginPath: 'preferred',
        timeoutMs: HOST_GIT_TIMEOUT_MS
      })
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || `git exited with code ${String(result.code)}`)
      }
      return result.stdout
    })
  )
  const cleanup = { fs, resolveGitExcludePath: git.resolveGitExcludePath }
  const runSkillsCli = async (spec: ProcessSpec): Promise<ProcessResult> =>
    fromWslRun(
      await runWslProcess({
        distro,
        script: wslLoginPathLaunchScript(spec.program),
        args: spec.args ?? [],
        cwd: spec.cwd ?? linuxPath,
        loginPath: 'preferred',
        timeoutMs: spec.timeoutMs ?? undefined
      })
    )
  return {
    workspaceRoot: linuxPath,
    cleanup,
    install: () => ({
      runProcess: runSkillsCli,
      npxCommand: 'npx',
      ...cleanup,
      ...git,
      ...extras({
        runCli: runSkillsCli,
        fs,
        homeDir: posixHomeDir(sh),
        pathApi: posix,
        workspaceRoot: linuxPath
      })
    }),
    isReachable: () => true
  }
}
