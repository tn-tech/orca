import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RunProcessModule from '../../../shared/child-process/run-process'
import type { ProcessResult } from '../../../shared/child-process/run-process'
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'

const sshHost = vi.hoisted(() => {
  const state: { provider: unknown } = { provider: undefined }
  return state
})

vi.mock('../../providers/ssh-git-dispatch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSshGitProvider: vi.fn(() => sshHost.provider)
}))
vi.mock('../../../shared/child-process/run-process', async (importOriginal) => {
  const actual = await importOriginal<typeof RunProcessModule>()
  return { ...actual, runProcess: vi.fn(actual.runProcess) }
})

import { runProcess } from '../../../shared/child-process/run-process'
import { OrchestrationDb } from '../orchestration/db'
import { createRunSkillProvisioner } from './workflow-skill-provisioning-host'
import { decideSourceTrust } from './workflow-source-trust'

const PLUGIN_ID = 'acme-decks@acme'
const pluginSkill: SkillReference = {
  name: 'deck-writer',
  source: { kind: 'plugin', plugin: PLUGIN_ID },
  required: true
}

type RelayRequest = { binary: string; args: string[]; cwd: string; stdin?: string }

let hostHome: string
let workspaceRoot: string
let db: OrchestrationDb

/** What `claude plugin install` leaves behind on the host: metadata, enablement, the skill. */
async function installPluginOnHost(): Promise<void> {
  const installPath = join(hostHome, '.claude/plugins/cache/acme/acme-decks/1.0.0')
  await mkdir(join(installPath, 'skills/deck-writer'), { recursive: true })
  await writeFile(
    join(hostHome, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({ plugins: { [PLUGIN_ID]: [{ scope: 'user', installPath }] } })
  )
  await writeFile(
    join(hostHome, '.claude/settings.json'),
    JSON.stringify({ enabledPlugins: { [PLUGIN_ID]: true } })
  )
}

/** Stands in for the relay: shell file operations run for real, `$HOME` is the host's own. */
const claudeActivity = { running: 0, peak: 0 }

function relayWithClaude() {
  const actual = vi.importActual<typeof RunProcessModule>(
    '../../../shared/child-process/run-process'
  )
  return vi.fn(async (request: RelayRequest) => {
    let result: ProcessResult
    if (request.binary === 'claude') {
      claudeActivity.running += 1
      claudeActivity.peak = Math.max(claudeActivity.peak, claudeActivity.running)
      await new Promise((resolve) => setTimeout(resolve, 20))
      claudeActivity.running -= 1
      await installPluginOnHost()
      result = { code: 0, signal: null, stdout: 'Installed', stderr: '', timedOut: false }
    } else {
      result = await (
        await actual
      ).runProcess({
        program: request.binary,
        args: request.args,
        cwd: request.cwd,
        env: { ...process.env, HOME: hostHome },
        ...(request.stdin === undefined ? {} : { input: request.stdin })
      })
    }
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      timedOut: result.timedOut
    }
  })
}

function sshProvisioner(root = workspaceRoot) {
  return createRunSkillProvisioner(
    {
      workspaceRoot: root,
      orcaIgnoreTarget: { host: 'remote', repoPath: root, connectionId: 'conn-1' }
    },
    db
  )
}

describe('createRunSkillProvisioner — plugin skills on an SSH host (FR-018, FR-018a)', () => {
  let relayExec: ReturnType<typeof relayWithClaude>

  beforeEach(async () => {
    hostHome = await mkdtemp(join(tmpdir(), 'workflow-plugin-host-home-'))
    await mkdir(join(hostHome, '.claude/plugins'), { recursive: true })
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-plugin-host-ws-'))
    db = new OrchestrationDb(':memory:')
    relayExec = relayWithClaude()
    sshHost.provider = { exec: vi.fn(), execNonInteractiveOperation: relayExec }
    vi.mocked(runProcess).mockClear()
    claudeActivity.peak = 0
  })

  afterEach(async () => {
    sshHost.provider = undefined
    db.close()
    await rm(hostHome, { recursive: true, force: true })
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it('asks to trust the source for that SSH host and installs nothing', async () => {
    const outcome = await sshProvisioner().provision({
      runId: 'wfr_1',
      agent: 'claude',
      skills: [pluginSkill]
    })

    expect(outcome).toEqual({
      kind: 'trust-required',
      question: {
        source: PLUGIN_ID,
        skills: ['deck-writer'],
        agents: ['claude'],
        host: 'ssh:conn-1'
      }
    })
    expect(relayExec.mock.calls.some(([request]) => request.binary === 'claude')).toBe(false)
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('installs a trusted source with the verified command on the host, never locally', async () => {
    decideSourceTrust(
      db,
      { notifyWorkflowRunChanged: vi.fn() },
      { host: 'ssh:conn-1', source: PLUGIN_ID, decision: 'trusted', decidedBy: 'me' }
    )

    const outcome = await sshProvisioner().provision({
      runId: 'wfr_1',
      agent: 'claude',
      skills: [pluginSkill]
    })

    expect(outcome).toEqual({ kind: 'ready', installed: ['deck-writer'] })
    const claude = relayExec.mock.calls.map(([r]) => r).filter((r) => r.binary === 'claude')
    expect(claude).toEqual([
      expect.objectContaining({
        args: ['plugin', 'install', PLUGIN_ID, '--scope', 'user'],
        cwd: workspaceRoot
      })
    ])
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('does not reuse a local trust decision for the SSH host', async () => {
    decideSourceTrust(
      db,
      { notifyWorkflowRunChanged: vi.fn() },
      { host: 'local', source: PLUGIN_ID, decision: 'trusted', decidedBy: 'me' }
    )

    const outcome = await sshProvisioner().provision({
      runId: 'wfr_1',
      agent: 'claude',
      skills: [pluginSkill]
    })
    expect(outcome.kind).toBe('trust-required')
  })

  it('asks nothing when the plugin skill is already present on the host', async () => {
    await installPluginOnHost()

    expect(
      await sshProvisioner().provision({ runId: 'wfr_1', agent: 'claude', skills: [pluginSkill] })
    ).toEqual({ kind: 'ready', installed: [] })
  })

  it('never runs two plugin installs at once on one host, even from two workspaces', async () => {
    decideSourceTrust(
      db,
      { notifyWorkflowRunChanged: vi.fn() },
      { host: 'ssh:conn-1', source: PLUGIN_ID, decision: 'trusted', decidedBy: 'me' }
    )
    const otherRoot = await mkdtemp(join(tmpdir(), 'workflow-plugin-host-ws2-'))
    try {
      const request = { runId: 'wfr_1', agent: 'claude', skills: [pluginSkill] }
      const results = await Promise.all([
        sshProvisioner().provision(request),
        sshProvisioner(otherRoot).provision({ ...request, runId: 'wfr_2' })
      ])

      expect(results.every((outcome) => outcome.kind === 'ready')).toBe(true)
      expect(claudeActivity.peak).toBe(1)
    } finally {
      await rm(otherRoot, { recursive: true, force: true })
    }
  })
})
