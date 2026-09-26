import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'
import { validateGitExecArgs } from '../../../relay/git-exec-validator'
import type * as RunProcessModule from '../../../shared/child-process/run-process'

const sshHost = vi.hoisted(() => {
  const state: { provider: unknown } = { provider: undefined }
  return state
})

vi.mock('../../providers/ssh-git-dispatch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSshGitProvider: vi.fn(() => sshHost.provider)
}))
vi.mock('../../wsl/wsl-runner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runWslProcess: vi.fn()
}))
// Passes through by default; SSH tests assert nothing ever launches on this machine.
vi.mock('../../../shared/child-process/run-process', async (importOriginal) => {
  const actual = await importOriginal<typeof RunProcessModule>()
  return { ...actual, runProcess: vi.fn(actual.runProcess) }
})
vi.mock('./workflow-source-allowlist', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRepoWorkflowSourceAllowlist: vi.fn(async () => ['https://github.com/acme/consulting-skills'])
}))

import { runProcess } from '../../../shared/child-process/run-process'
import { runWslProcess } from '../../wsl/wsl-runner'
import {
  provisionNodeSkills,
  releaseRunSkillInstalls,
  type ProvisionNodeSkillsInput
} from './workflow-skill-provisioning'
import { createRunSkillProvisioner } from './workflow-skill-provisioning-host'
import {
  createSkillPorts,
  fakeSkillsCli,
  relayExecEmulator,
  relayGitExecEmulator,
  REPO_SOURCE,
  repoSkill,
  skillInput,
  wslExeEmulator,
  wslRunnerEmulator
} from './workflow-skill-provisioning-test-fixtures'
import { getRepoWorkflowSourceAllowlist } from './workflow-source-allowlist'

const pluginSkill: SkillReference = {
  name: 'deck-writer',
  source: { kind: 'plugin', plugin: 'acme-decks' },
  required: true
}

let workspaceRoot: string
let excludePath: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'orca-skill-provisioning-'))
  excludePath = join(workspaceRoot, '.git', 'info', 'exclude')
  await mkdir(join(workspaceRoot, '.git', 'info'), { recursive: true })
  await writeFile(excludePath, '# user entry\n/scratch\n')
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

function createPorts(overrides: Parameters<typeof createSkillPorts>[2] = {}) {
  return createSkillPorts(workspaceRoot, excludePath, overrides)
}

function input(overrides: Partial<ProvisionNodeSkillsInput> = {}): ProvisionNodeSkillsInput {
  return skillInput(workspaceRoot, overrides)
}

describe('provisionNodeSkills — repository skills', () => {
  it('runs `skills add <location> --skill <name> --agent <provider> -y` in the run workspace', async () => {
    const { ports } = createPorts()
    const outcome = await provisionNodeSkills(input(), ports)

    expect(outcome).toEqual({ kind: 'ready', installed: ['model-review'] })
    expect(ports.runProcess).toHaveBeenCalledTimes(1)
    const spec = vi.mocked(ports.runProcess).mock.calls[0][0]
    expect(spec.program).toBe('/usr/local/bin/npx')
    expect(spec.cwd).toBe(workspaceRoot)
    expect(spec.args).toEqual([
      '--yes',
      'skills',
      'add',
      REPO_SOURCE,
      '--skill',
      'model-review',
      '--agent',
      'claude-code',
      '-y'
    ])
  })

  it('appends each installed path to .git/info/exclude and removes them on cleanup', async () => {
    const { ports } = createPorts()
    await provisionNodeSkills(input(), ports)

    const exclude = await readFile(excludePath, 'utf-8')
    expect(exclude).toContain('/scratch\n')
    expect(exclude).toContain('/.claude/skills/model-review\n')
    expect(exclude).toContain('/.agents/skills/model-review\n')
    expect(exclude).toContain('/skills-lock.json\n')
    expect(exclude).not.toMatch(/^\/\.claude\/skills$/m)

    await releaseRunSkillInstalls({ runId: 'wfr_1', workspaceRoot }, ports)

    expect(await readFile(excludePath, 'utf-8')).toBe('# user entry\n/scratch\n')
    expect(existsSync(join(workspaceRoot, '.claude/skills/model-review'))).toBe(false)
    expect(existsSync(join(workspaceRoot, 'skills-lock.json'))).toBe(false)
  })

  it('skips the install and the exclude entry when the skill is already in the workspace', async () => {
    await mkdir(join(workspaceRoot, '.claude/skills/model-review'), { recursive: true })
    const { ports } = createPorts()

    expect(await provisionNodeSkills(input(), ports)).toEqual({ kind: 'ready', installed: [] })
    expect(ports.runProcess).not.toHaveBeenCalled()
    expect(await readFile(excludePath, 'utf-8')).toBe('# user entry\n/scratch\n')
  })

  it('writes no exclude entry for a folder workspace without git', async () => {
    const { ports } = createPorts({ resolveGitExcludePath: async () => null })

    expect(await provisionNodeSkills(input(), ports)).toMatchObject({ kind: 'ready' })
    expect(await readFile(excludePath, 'utf-8')).toBe('# user entry\n/scratch\n')
  })

  it('fails with the CLI output when the install exits non-zero, before any launch', async () => {
    const { ports } = createPorts({
      runProcess: fakeSkillsCli(workspaceRoot, { code: 1, stderr: 'repository not found' })
    })

    const outcome = await provisionNodeSkills(input(), ports)
    expect(outcome).toMatchObject({ kind: 'failed' })
    expect(outcome.kind === 'failed' && outcome.reason).toContain('model-review')
    expect(outcome.kind === 'failed' && outcome.reason).toContain('repository not found')
  })

  it('refuses a source missing from the allowlist, naming the source and allowlist location', async () => {
    const { ports } = createPorts()
    const outcome = await provisionNodeSkills(
      input({ readAllowlist: async () => ({ sources: [], location: '/repo/orca.yaml' }) }),
      ports
    )

    expect(outcome).toMatchObject({
      kind: 'failed',
      code: 'workflow_source_not_allowed',
      allowlistPath: '/repo/orca.yaml'
    })
    expect(outcome.kind === 'failed' && outcome.reason).toContain(REPO_SOURCE)
    expect(ports.runProcess).not.toHaveBeenCalled()
  })
})

describe('provisionNodeSkills — plugin skills', () => {
  it('yields a trust question when the source has no trust decision on this host', async () => {
    const { ports, plugins } = createPorts({ trust: 'needs-question' })

    const outcome = await provisionNodeSkills(input({ skills: [pluginSkill, repoSkill] }), ports)

    expect(outcome).toEqual({
      kind: 'trust-required',
      question: { source: 'acme-decks', skills: ['deck-writer'], agents: ['claude'] }
    })
    expect(plugins.install).not.toHaveBeenCalled()
    expect(ports.runProcess).not.toHaveBeenCalled()
  })

  it('fails the node without installing when trust is refused', async () => {
    const { ports, plugins } = createPorts({ trust: 'refused' })

    const outcome = await provisionNodeSkills(input({ skills: [pluginSkill] }), ports)

    expect(outcome).toMatchObject({ kind: 'failed' })
    expect(outcome.kind === 'failed' && outcome.reason).toContain('acme-decks')
    expect(plugins.install).not.toHaveBeenCalled()
  })

  it('installs a trusted source through the provider plugin command', async () => {
    const { ports, plugins } = createPorts({ trust: 'trusted' })

    const outcome = await provisionNodeSkills(input({ skills: [pluginSkill] }), ports)

    expect(outcome).toEqual({ kind: 'ready', installed: ['deck-writer'] })
    expect(plugins.install).toHaveBeenCalledWith({ plugin: 'acme-decks', agent: 'claude' })
  })

  it('asks nothing when the plugin skill is already installed on the host', async () => {
    const { ports, plugins, trustGate } = createPorts()
    plugins.isInstalled.mockResolvedValue(true)

    expect(await provisionNodeSkills(input({ skills: [pluginSkill] }), ports)).toEqual({
      kind: 'ready',
      installed: []
    })
    expect(trustGate.decide).not.toHaveBeenCalled()
  })

  it('fails with the provider reason when the plugin install fails', async () => {
    const { ports, plugins } = createPorts({ trust: 'trusted' })
    plugins.install.mockResolvedValue({ ok: false, reason: 'aider has no plugin command' })

    const outcome = await provisionNodeSkills(input({ skills: [pluginSkill] }), ports)
    expect(outcome.kind === 'failed' && outcome.reason).toContain('aider has no plugin command')
  })
})

describe('provisionNodeSkills — prompt fallback', () => {
  it('returns the repository skills for the prompt when the agent has no workspace skill path', async () => {
    const { ports } = createPorts()

    const outcome = await provisionNodeSkills(input({ agent: 'aider' }), ports)

    expect(outcome).toEqual({
      kind: 'ready',
      installed: [],
      promptFallback: { agent: 'aider', skills: [repoSkill] }
    })
    expect(ports.runProcess).not.toHaveBeenCalled()
  })

  it('does nothing for a node without skills', async () => {
    const { ports } = createPorts()
    const readAllowlist = vi.fn()
    expect(await provisionNodeSkills(input({ skills: [], readAllowlist }), ports)).toEqual({
      kind: 'ready',
      installed: []
    })
    expect(readAllowlist).not.toHaveBeenCalled()
  })
})

const SKILLS_ADD_ARGS = [
  '--yes',
  'skills',
  'add',
  REPO_SOURCE,
  '--skill',
  'model-review',
  '--agent',
  'claude-code',
  '-y'
]
// The relay clamps `agent.execNonInteractive` to five minutes.
const RELAY_EXEC_MAX_TIMEOUT_MS = 5 * 60_000

async function gitInWorkspace(args: string[]): Promise<void> {
  const result = await runProcess({ program: 'git', args, cwd: workspaceRoot })
  expect(result.code).toBe(0)
}

describe('createRunSkillProvisioner — SSH workspaces', () => {
  let relayExec: ReturnType<typeof relayExecEmulator>
  let gitExec: ReturnType<typeof relayGitExecEmulator>

  function useRelay(skillsCli = fakeSkillsCli(workspaceRoot)) {
    relayExec = relayExecEmulator(skillsCli)
    gitExec = relayGitExecEmulator(validateGitExecArgs)
    sshHost.provider = { exec: gitExec, execNonInteractiveOperation: relayExec }
  }

  function sshProvisioner(root = workspaceRoot) {
    return createRunSkillProvisioner({
      workspaceRoot: root,
      orcaIgnoreTarget: { host: 'remote', repoPath: root, connectionId: 'conn-1' }
    })
  }

  beforeEach(async () => {
    await gitInWorkspace(['init', '-q'])
    useRelay()
    vi.mocked(runProcess).mockClear()
  })

  afterEach(() => {
    sshHost.provider = undefined
  })

  it('installs through the relay exec path on the host, then cleans up there', async () => {
    const provisioner = sshProvisioner()

    expect(
      await provisioner.provision({ runId: 'wfr_1', agent: 'claude', skills: [repoSkill] })
    ).toEqual({ kind: 'ready', installed: ['model-review'] })

    const npx = relayExec.mock.calls.map(([request]) => request).filter((r) => r.binary === 'npx')
    expect(npx).toEqual([
      {
        binary: 'npx',
        args: SKILLS_ADD_ARGS,
        cwd: workspaceRoot,
        timeoutMs: RELAY_EXEC_MAX_TIMEOUT_MS,
        operation: 'workflow-skills'
      }
    ])
    expect(relayExec.mock.calls.every(([r]) => r.timeoutMs <= RELAY_EXEC_MAX_TIMEOUT_MS)).toBe(true)
    expect(getRepoWorkflowSourceAllowlist).toHaveBeenCalledWith({
      path: workspaceRoot,
      connectionId: 'conn-1'
    })
    expect(gitExec.mock.calls.map(([args]) => args)).toEqual([
      [
        'ls-files',
        '-z',
        '--',
        '.agents/skills/model-review',
        '.claude/skills/model-review',
        'skills-lock.json'
      ],
      ['rev-parse', '--git-path', 'info/exclude']
    ])
    const exclude = await readFile(excludePath, 'utf-8')
    expect(exclude).toContain('/.claude/skills/model-review\n')
    expect(exclude).toContain('/skills-lock.json\n')

    await provisioner.release('wfr_1')

    expect(await readFile(excludePath, 'utf-8')).toBe('# user entry\n/scratch\n')
    expect(existsSync(join(workspaceRoot, '.claude/skills/model-review'))).toBe(false)
    expect(existsSync(join(workspaceRoot, '.agents/skills/model-review'))).toBe(false)
    expect(existsSync(join(workspaceRoot, '.orca/workflow-skills/ledger.json'))).toBe(false)
    // Every git and file operation reached the host; nothing ran on this machine.
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('refuses to modify a path the project tracks on the host', async () => {
    await writeFile(join(workspaceRoot, 'skills-lock.json'), '{"committed":true}')
    await gitInWorkspace(['add', 'skills-lock.json'])

    const outcome = await sshProvisioner().provision({
      runId: 'wfr_1',
      agent: 'claude',
      skills: [repoSkill]
    })

    expect(outcome).toMatchObject({ kind: 'failed' })
    expect(outcome.kind === 'failed' && outcome.reason).toContain('skills-lock.json')
    expect(relayExec.mock.calls.some(([r]) => r.binary === 'npx')).toBe(false)
  })

  it('rolls back a failed install and restores the untracked user file it snapshotted', async () => {
    await writeFile(join(workspaceRoot, 'skills-lock.json'), '{"user":true}')
    useRelay(fakeSkillsCli(workspaceRoot, { code: 1, partial: true, stderr: 'network down' }))

    const outcome = await sshProvisioner().provision({
      runId: 'wfr_1',
      agent: 'claude',
      skills: [repoSkill]
    })

    expect(outcome.kind === 'failed' && outcome.reason).toContain('network down')
    expect(await readFile(join(workspaceRoot, 'skills-lock.json'), 'utf-8')).toBe('{"user":true}')
    expect(existsSync(join(workspaceRoot, '.claude/skills/model-review'))).toBe(false)
    expect(existsSync(join(workspaceRoot, '.orca/workflow-skills/backups/skills-lock.json'))).toBe(
      false
    )
    expect(await readFile(excludePath, 'utf-8')).toBe('# user entry\n/scratch\n')
  })

  it('refuses the allowlist miss before anything runs on the host', async () => {
    vi.mocked(getRepoWorkflowSourceAllowlist).mockResolvedValueOnce([])

    const outcome = await sshProvisioner().provision({
      runId: 'wfr_1',
      agent: 'claude',
      skills: [repoSkill]
    })

    expect(outcome).toMatchObject({ kind: 'failed', code: 'workflow_source_not_allowed' })
    expect(relayExec.mock.calls.some(([r]) => r.binary === 'npx')).toBe(false)
  })

  it('refuses with workflow_host_unreachable and never installs locally when the host is gone', async () => {
    sshHost.provider = undefined

    const outcome = await sshProvisioner().provision({
      runId: 'wfr_1',
      agent: 'claude',
      skills: [repoSkill]
    })

    expect(outcome).toMatchObject({ kind: 'failed', code: 'workflow_host_unreachable' })
    expect(outcome.kind === 'failed' && outcome.reason).toContain('nothing was installed')
    expect(relayExec).not.toHaveBeenCalled()
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('reports workflow_host_unreachable when the connection drops mid-install', async () => {
    relayExec.mockImplementation(async (request) => {
      if (request.binary === 'npx') {
        sshHost.provider = undefined
        throw new Error('SSH connection closed')
      }
      return relayExecEmulator(fakeSkillsCli(workspaceRoot))(request)
    })

    const outcome = await sshProvisioner().provision({
      runId: 'wfr_1',
      agent: 'claude',
      skills: [repoSkill]
    })

    expect(outcome).toMatchObject({ kind: 'failed', code: 'workflow_host_unreachable' })
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('refuses a Windows SSH host, which has no POSIX shell to install with', async () => {
    const outcome = await sshProvisioner('C:\\Users\\dev\\repo').provision({
      runId: 'wfr_1',
      agent: 'claude',
      skills: [repoSkill]
    })

    expect(outcome.kind).toBe('failed')
    expect(relayExec).not.toHaveBeenCalled()
    expect(runProcess).not.toHaveBeenCalled()
  })
})

describe('createRunSkillProvisioner — WSL workspaces', () => {
  const uncRoot = () => `//wsl.localhost/Ubuntu${workspaceRoot}`

  beforeEach(async () => {
    await gitInWorkspace(['init', '-q'])
    vi.mocked(runProcess).mockReset()
    vi.mocked(runProcess).mockImplementation(wslExeEmulator('Ubuntu'))
    vi.mocked(runWslProcess).mockReset()
    vi.mocked(runWslProcess).mockImplementation(wslRunnerEmulator(fakeSkillsCli(workspaceRoot)))
  })

  afterEach(async () => {
    const actual = await vi.importActual<typeof RunProcessModule>(
      '../../../shared/child-process/run-process'
    )
    vi.mocked(runProcess).mockReset()
    vi.mocked(runProcess).mockImplementation(actual.runProcess)
  })

  it('installs inside the distro through wsl.exe --exec, then cleans up there', async () => {
    const provisioner = createRunSkillProvisioner({
      workspaceRoot: uncRoot(),
      orcaIgnoreTarget: { host: 'local', repoPath: uncRoot() }
    })

    expect(
      await provisioner.provision({ runId: 'wfr_1', agent: 'claude', skills: [repoSkill] })
    ).toEqual({ kind: 'ready', installed: ['model-review'] })

    // The skills CLI runs on the login PATH, in the guest workspace, never through a local npx.
    const npx = vi.mocked(runWslProcess).mock.calls.filter(([spec]) => spec.script !== undefined)
    expect(npx).toHaveLength(1)
    expect(npx[0][0]).toMatchObject({
      distro: 'Ubuntu',
      cwd: workspaceRoot,
      args: SKILLS_ADD_ARGS,
      loginPath: 'preferred'
    })
    expect(npx[0][0].script).toContain('exec "$resolved" "$@"')
    const gitCalls = vi.mocked(runWslProcess).mock.calls.filter(([spec]) => spec.program === 'git')
    expect(gitCalls.every(([spec]) => spec.distro === 'Ubuntu' && spec.cwd === workspaceRoot)).toBe(
      true
    )
    expect(getRepoWorkflowSourceAllowlist).toHaveBeenCalledWith({ path: uncRoot() })
    expect(await readFile(excludePath, 'utf-8')).toContain('/.claude/skills/model-review\n')

    await provisioner.release('wfr_1')

    expect(await readFile(excludePath, 'utf-8')).toBe('# user entry\n/scratch\n')
    expect(existsSync(join(workspaceRoot, '.claude/skills/model-review'))).toBe(false)
    // wslExeEmulator throws on anything but `wsl.exe -d Ubuntu --exec ...`.
    expect(vi.mocked(runProcess).mock.calls.length).toBeGreaterThan(0)
    for (const [spec] of vi.mocked(runProcess).mock.calls) {
      expect(spec.program).toMatch(/wsl(\.exe)?$/i)
      expect(spec.args?.slice(0, 3)).toEqual(['-d', 'Ubuntu', '--exec'])
    }
  })
})
