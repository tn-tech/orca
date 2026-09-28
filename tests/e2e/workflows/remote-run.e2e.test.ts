/**
 * T124 / SC-008: a workflow started from a paired client keeps running on the `orca serve` host
 * after that client disconnects, and a client reconnecting after the run finished sees the
 * complete run. The client is the CLI over `--pairing-code` from its own empty profile, so every
 * call it makes crosses the paired WebSocket transport, never the host's local socket.
 *
 * The implement node's worker_done is held by worker-done-gate.mjs until the client is gone,
 * which makes "the run advanced while disconnected" a certainty rather than a race.
 *
 * Run with `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:workflows:e2e` (builds out/ first).
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NodeAttemptView, RunSnapshot } from '../../../src/shared/workflows/workflow-run-types'
import { forceTerminateProcessTree } from '../../../src/shared/child-process/process-tree-termination'
import { runProcess, spawnProcess } from '../../../src/shared/child-process/run-process'
import { createSampleWorkflowRepo } from '../../fixtures/workflows/create-sample-repo'
import {
  launchHeadlessWorkflowRuntime,
  missingBuiltEntryPoints,
  ORCA_DEV_CLI,
  REPO_ROOT,
  type CliEnvelope,
  type HeadlessWorkflowRuntime,
  type StubAgentScript
} from './headless-workflow-runtime'

type RunStatus = RunSnapshot & { attempts: NodeAttemptView[] }

const TWO_NODE_FIXTURE = join(__dirname, '../../fixtures/workflows/two-node.workflow.yaml')
const GATE_SCRIPT = join(__dirname, 'worker-done-gate.mjs')
const STUB_SCRIPT: StubAgentScript = {
  implement: { '0': { result: { summary: 'Added the greeting.' } } },
  review: { '0': { result: { approved: true, findings: [] } } }
}
// Why /tmp: the client profile dir follows the host harness's short-path rule for Unix sockets.
const SCRATCH_PARENT = '/tmp'
// Longer than the CLI's `status --wait` poll interval, so the watcher is mid-loop when cut off.
const WATCHER_CONNECTED_MS = 3_000

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function waitFor(what: string, check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`)
    }
    await delay(200)
  }
}

describe.skipIf(process.platform === 'win32')('remote workflow run (paired client e2e)', () => {
  let runtime: HeadlessWorkflowRuntime
  let repoPath: string
  let scratchDir: string
  let clientEnv: NodeJS.ProcessEnv
  let gateLog: string
  let runId: string
  let beforeDisconnect: RunStatus
  let watcher: ChildProcessWithoutNullStreams | null = null
  let watcherStillConnected = false
  let disconnectedAt: number
  let reconnected: RunStatus
  let hostView: RunStatus

  const gateLines = (): string[] =>
    existsSync(gateLog) ? readFileSync(gateLog, 'utf8').split('\n').filter(Boolean) : []

  async function pairedCli<TResult>(args: string[], cwd = REPO_ROOT): Promise<TResult> {
    const result = await runProcess({
      program: process.execPath,
      args: [ORCA_DEV_CLI, ...args, '--pairing-code', runtime.pairingUrl ?? '', '--json'],
      cwd,
      env: clientEnv,
      timeoutMs: 30_000
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: `orca --json` prints this envelope; `ok` is checked next.
    const envelope = JSON.parse(result.stdout) as CliEnvelope<TResult>
    if (!envelope.ok) {
      throw new Error(`paired orca ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
    }
    return envelope.result
  }

  beforeAll(async () => {
    const missing = missingBuiltEntryPoints()
    if (missing.length > 0) {
      throw new Error(
        `Build first (pnpm run build:cli && pnpm run build:electron-vite); missing: ${missing.join(', ')}`
      )
    }
    ;({ repoPath } = await createSampleWorkflowRepo())
    copyFileSync(TWO_NODE_FIXTURE, join(repoPath, 'orca-workflows', 'two-node.workflow.yaml'))
    for (const args of [
      ['add', '-A'],
      ['commit', '-m', 'Add two-node workflow']
    ]) {
      const git = await runProcess({ program: 'git', args, cwd: repoPath })
      expect(git.code, git.stderr).toBe(0)
    }

    scratchDir = mkdtempSync(join(SCRATCH_PARENT, 'orca-e2e-wf-client-'))
    gateLog = join(scratchDir, 'gate.log')
    const gateFile = join(scratchDir, 'gate.open')
    runtime = await launchHeadlessWorkflowRuntime({
      stubScript: STUB_SCRIPT,
      pairing: true,
      stubOrcaCommand: `${process.execPath} ${GATE_SCRIPT}`,
      extraEnv: {
        WORKFLOW_E2E_REAL_ORCA: `${process.execPath} ${ORCA_DEV_CLI}`,
        WORKFLOW_E2E_GATE_FILE: gateFile,
        WORKFLOW_E2E_GATE_LOG: gateLog
      }
    })
    // An empty profile of its own: no local runtime to fall back to, only the pairing.
    const clientProfile = join(scratchDir, 'client-profile')
    clientEnv = {
      ...runtime.env,
      ORCA_DEV_USER_DATA_PATH: clientProfile,
      ORCA_USER_DATA_PATH: clientProfile
    }
    await runtime.cli(['repo', 'add', '--path', repoPath])

    ;({ runId } = await pairedCli<{ runId: string }>(
      ['workflows', 'run', '--name', 'two-node', '--objective', 'Add a greeting'],
      repoPath
    ))
    await waitFor('the implement worker to report done', () => gateLines().includes('held'), 90_000)
    beforeDisconnect = await pairedCli<RunStatus>(['workflows', 'status', '--run-id', runId])

    watcher = spawnProcess({
      program: process.execPath,
      args: [
        ORCA_DEV_CLI,
        'workflows',
        'status',
        '--run-id',
        runId,
        '--wait',
        '--pairing-code',
        runtime.pairingUrl ?? '',
        '--json'
      ],
      cwd: REPO_ROOT,
      env: clientEnv,
      detached: true
    })
    await delay(WATCHER_CONNECTED_MS)
    watcherStillConnected = watcher.exitCode === null && watcher.signalCode === null
    // Abrupt, like a closed laptop lid: no graceful close frame reaches the host.
    await forceTerminateProcessTree(watcher)
    disconnectedAt = Date.now()

    writeFileSync(gateFile, '')
    await waitFor(
      'both workers to deliver worker_done with no client connected',
      () => gateLines().filter((line) => line.startsWith('sent')).length === 2,
      120_000
    )

    // The engine settles the end node just after review's worker_done lands.
    const reconnectDeadline = Date.now() + 60_000
    reconnected = await pairedCli<RunStatus>(['workflows', 'status', '--run-id', runId])
    while (reconnected.state === 'running' && Date.now() < reconnectDeadline) {
      await delay(500)
      reconnected = await pairedCli<RunStatus>(['workflows', 'status', '--run-id', runId])
    }
    hostView = await runtime.cli<RunStatus>(['workflows', 'status', '--run-id', runId])
  }, 240_000)

  afterAll(async () => {
    if (watcher) {
      await forceTerminateProcessTree(watcher)
    }
    await runtime?.dispose()
    for (const dir of [repoPath, scratchDir]) {
      if (dir) {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  }, 60_000)

  function attemptFor(snapshot: RunStatus, nodeId: string): NodeAttemptView | undefined {
    const matches = snapshot.attempts.filter((attempt) => attempt.nodeId === nodeId)
    expect(matches.length, `attempts for ${nodeId}`).toBeLessThanOrEqual(1)
    return matches[0]
  }

  it('reaches the host only through the pairing', async () => {
    const localOnly = await runProcess({
      program: process.execPath,
      args: [ORCA_DEV_CLI, 'status', '--json'],
      cwd: REPO_ROOT,
      env: clientEnv,
      timeoutMs: 30_000
    })
    expect(localOnly.stdout).toMatch(/"reachable":\s*false/)
  })

  it('had the run mid-flight, with a connected watcher, when the client dropped', () => {
    expect(beforeDisconnect.state).toBe('running')
    expect(attemptFor(beforeDisconnect, 'implement')?.state).toBe('running')
    expect(attemptFor(beforeDisconnect, 'review')).toBeUndefined()
    expect(watcherStillConnected, 'status --wait exited before it was cut off').toBe(true)
  })

  it('advanced the run on the host while no client was connected', () => {
    const implement = attemptFor(reconnected, 'implement')
    const review = attemptFor(reconnected, 'review')
    expect(Date.parse(implement?.finishedAt ?? '')).toBeGreaterThanOrEqual(disconnectedAt)
    expect(Date.parse(review?.startedAt ?? '')).toBeGreaterThanOrEqual(disconnectedAt)
  })

  it('shows the reconnecting client the completed run with every node result', () => {
    expect(reconnected.state).toBe('completed')
    for (const nodeId of ['start', 'implement', 'review', 'end']) {
      expect(attemptFor(reconnected, nodeId)).toMatchObject({ state: 'completed', iteration: 0 })
    }
    expect(attemptFor(reconnected, 'implement')?.resultJson).toEqual({
      summary: 'Added the greeting.'
    })
    expect(attemptFor(reconnected, 'review')?.resultJson).toEqual({
      approved: true,
      findings: []
    })
    // Nothing lost in transit: the paired snapshot is the host's own view.
    expect(reconnected).toEqual(hostView)
  })
})
