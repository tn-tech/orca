import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { vi } from 'vitest'
import type {
  ProcessResult,
  ProcessSpec,
  runProcess
} from '../../../shared/child-process/run-process'
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'
import type { WslSpec } from '../../wsl/wsl-runner'
import type {
  ProvisionNodeSkillsInput,
  WorkflowPluginInstallResult,
  WorkflowSkillProvisioningPorts,
  WorkflowSkillTrustDecision
} from './workflow-skill-provisioning'
import { localWorkflowSkillFilesystem } from './workflow-skill-provisioning-host'

export const REPO_SOURCE = 'https://github.com/acme/consulting-skills'
export const repoSkill: SkillReference = {
  name: 'model-review',
  source: { kind: 'repository', location: REPO_SOURCE },
  required: true
}

/**
 * Fake `skills add`: lands the skill where the real CLI does for `--agent claude-code`.
 * `partial` writes those paths and still exits non-zero, like a CLI killed mid-install.
 */
export function fakeSkillsCli(
  workspaceRoot: string,
  result: Partial<ProcessResult> & { partial?: boolean } = {}
) {
  return vi.fn(async (spec: ProcessSpec): Promise<ProcessResult> => {
    const code = result.code === undefined ? 0 : result.code
    if (code === 0 || result.partial) {
      const skill = spec.args?.[spec.args.indexOf('--skill') + 1] ?? 'missing'
      for (const dir of ['.agents/skills', '.claude/skills']) {
        await mkdir(join(workspaceRoot, dir, skill), { recursive: true })
        await writeFile(join(workspaceRoot, dir, skill, 'SKILL.md'), `# ${skill}\n`)
      }
      await writeFile(join(workspaceRoot, 'skills-lock.json'), `{"cli":"${skill}"}`)
    }
    const timedOut = result.timedOut ?? false
    return { code, signal: null, stdout: '', stderr: result.stderr ?? '', timedOut }
  })
}

export function createSkillPorts(
  workspaceRoot: string,
  excludePath: string | null,
  overrides: Partial<Omit<WorkflowSkillProvisioningPorts, 'trust'>> & {
    trust?: WorkflowSkillTrustDecision
  } = {}
) {
  const { trust = 'needs-question', ...rest } = overrides
  // A successful install makes the plugin's skills present, as on a real host.
  const installedPlugins = new Set<string>()
  const plugins = {
    isInstalled: vi.fn(async (request: { plugin: string }) => installedPlugins.has(request.plugin)),
    unavailableReason: vi.fn((_request: { plugin: string; agent: string }): string | undefined => {
      return undefined
    }),
    install: vi.fn(async (request: { plugin: string }): Promise<WorkflowPluginInstallResult> => {
      installedPlugins.add(request.plugin)
      return { ok: true }
    })
  }
  const trustGate = { decide: vi.fn(async () => trust) }
  const ports: WorkflowSkillProvisioningPorts = {
    runProcess: fakeSkillsCli(workspaceRoot),
    npxCommand: '/usr/local/bin/npx',
    fs: localWorkflowSkillFilesystem,
    resolveGitExcludePath: async () => excludePath,
    listTrackedPaths: vi.fn(async () => []),
    plugins,
    trust: trustGate,
    ...rest
  }
  return { ports, plugins, trustGate }
}

export function skillInput(
  workspaceRoot: string,
  overrides: Partial<ProvisionNodeSkillsInput> = {}
): ProvisionNodeSkillsInput {
  return {
    runId: 'wfr_1',
    agent: 'claude',
    skills: [repoSkill],
    workspaceRoot,
    readAllowlist: async () => ({ sources: [REPO_SOURCE], location: '/repo/orca.yaml' }),
    ...overrides
  }
}

async function actualRunProcess(spec: ProcessSpec): Promise<ProcessResult> {
  // Why importActual: test files mock run-process to catch any local skills CLI launch.
  const actual = await vi.importActual<{ runProcess: typeof runProcess }>(
    '../../../shared/child-process/run-process'
  )
  return actual.runProcess(spec)
}

export type RelayExecRequest = {
  binary: string
  args: string[]
  cwd: string
  timeoutMs: number
  operation: string
  stdin?: string
}

/**
 * Stands in for the relay's `agent.execNonInteractive`: this machine plays the SSH host.
 * `npx` goes to the fake skills CLI; every other binary really runs.
 */
export function relayExecEmulator(skillsCli: (spec: ProcessSpec) => Promise<ProcessResult>) {
  return vi.fn(async (request: RelayExecRequest) => {
    const spec: ProcessSpec = {
      program: request.binary,
      args: request.args,
      cwd: request.cwd,
      ...(request.stdin === undefined ? {} : { input: request.stdin })
    }
    const result = request.binary === 'npx' ? await skillsCli(spec) : await actualRunProcess(spec)
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      timedOut: result.timedOut
    }
  })
}

/** Stands in for the relay's `git.exec`: rejects what the real validator rejects, then runs git. */
export function relayGitExecEmulator(validate: (args: string[]) => void) {
  return vi.fn(async (args: string[], cwd: string, _options?: { timeoutMs?: number }) => {
    validate(args)
    const result = await actualRunProcess({ program: 'git', args, cwd })
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `git exited ${String(result.code)}`)
    }
    return { stdout: result.stdout, stderr: result.stderr }
  })
}

/** Stands in for `wsl.exe -d <distro> --exec <argv>`: runs the guest argv on this machine. */
export function wslExeEmulator(distro: string) {
  return vi.fn(async (spec: ProcessSpec): Promise<ProcessResult> => {
    const args = spec.args ?? []
    if (
      !/wsl(\.exe)?$/i.test(spec.program) ||
      args.slice(0, 3).join(' ') !== `-d ${distro} --exec`
    ) {
      throw new Error(`Not a wsl.exe --exec launch: ${spec.program} ${args.join(' ')}`)
    }
    const [program, ...rest] = args.slice(3)
    return actualRunProcess({ program, args: rest, ...(spec.input ? { input: spec.input } : {}) })
  })
}

/** Stands in for `runWslProcess`: git really runs in `cwd`; the npx script hits the fake CLI. */
export function wslRunnerEmulator(skillsCli: (spec: ProcessSpec) => Promise<ProcessResult>) {
  return vi.fn(async (spec: WslSpec) => {
    const result =
      spec.program === 'git'
        ? await actualRunProcess({ program: 'git', args: [...(spec.args ?? [])], cwd: spec.cwd })
        : await skillsCli({ program: 'npx', args: [...(spec.args ?? [])], cwd: spec.cwd })
    return { ...result, environmentResolved: true }
  })
}
