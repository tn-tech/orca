/**
 * A headless `orca serve` runtime on a disposable profile whose `claude`/`codex` launches are
 * routed to the deterministic workflow stub agent, plus a CLI runner bound to that runtime.
 * Never opens or focuses a window: `serve` is windowless and the profile is isolated.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  forceTerminateProcessTree,
  signalProcessTree
} from '../../../src/shared/child-process/process-tree-termination'
import { runProcess, spawnProcess } from '../../../src/shared/child-process/run-process'
import { createStubAgentLaunchOverrides } from '../../fixtures/workflows/stub-agent-launch-override'
import { getE2ECompletedOnboardingProfile } from '../helpers/e2e-completed-onboarding-profile'
import { createElectronHomeIsolation } from '../helpers/electron-home-isolation'
import { cleanupE2EDaemons } from '../helpers/electron-process-shutdown'

const REPO_ROOT = resolve(__dirname, '../../..')
const ORCA_DEV_CLI = join(REPO_ROOT, 'config', 'scripts', 'orca-dev.mjs')
const BUILT_ENTRY_POINTS = [
  join(REPO_ROOT, 'out', 'cli', 'index.js'),
  join(REPO_ROOT, 'out', 'main', 'index.js')
]
// Why not os.tmpdir() on POSIX: macOS's /var/folders/... prefix pushes the runtime's Unix
// sockets under the profile past the ~104-byte sun_path limit, so `listen` fails with EINVAL.
const USER_DATA_PARENT = process.platform === 'win32' ? tmpdir() : '/tmp'
const READY_TIMEOUT_MS = 60_000
const SERVE_EXIT_TIMEOUT_MS = 10_000

/** `{ [nodeId]: { [iteration]: { result, outcome? } } }`, the stub agent's WORKFLOW_STUB_SCRIPT. */
export type StubAgentScript = Record<
  string,
  Record<string, { result: unknown; outcome?: 'succeeded' | 'failed' }>
>

export type CliEnvelope<TResult> = { ok: boolean; result: TResult; error?: unknown }

export type HeadlessWorkflowRuntime = {
  /** Runs `orca <args> --json` from `cwd` against this runtime; throws unless `ok`. */
  cli<TResult>(args: string[], options?: { cwd?: string; timeoutMs?: number }): Promise<TResult>
  dispose(): Promise<void>
}

export function missingBuiltEntryPoints(): string[] {
  return BUILT_ENTRY_POINTS.filter((entry) => !existsSync(entry))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true)
  }
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveExit(true)
    })
  })
}

function parseEnvelope<TResult>(stdout: string): CliEnvelope<TResult> | null {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (typeof parsed === 'object' && parsed !== null && 'ok' in parsed) {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every `orca --json` command prints this envelope; `ok` was checked above and callers name the result shape they requested.
      return parsed as CliEnvelope<TResult>
    }
  } catch {
    // Not JSON: reported by the caller with the raw output.
  }
  return null
}

export async function launchHeadlessWorkflowRuntime(options: {
  stubScript: StubAgentScript
}): Promise<HeadlessWorkflowRuntime> {
  const userDataDir = realpathSync(mkdtempSync(join(USER_DATA_PARENT, 'orca-e2e-wf-')))
  const profile = getE2ECompletedOnboardingProfile()
  const settings = { ...profile.settings, agentCmdOverrides: createStubAgentLaunchOverrides() }
  writeFileSync(
    join(userDataDir, 'orca-data.json'),
    `${JSON.stringify({ ...profile, settings }, null, 2)}\n`
  )
  // Why strip it: agent runtimes export ELECTRON_RUN_AS_NODE, which would make the spawned
  // Electron behave as plain Node.
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...inheritedEnv } = process.env
  void _electronRunAsNode
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: { ORCA_BACKGROUND_LAUNCH: '1' },
    extraEnv: {
      // Inherited by every worker PTY the runtime spawns, which is where the stub reads them.
      WORKFLOW_STUB_SCRIPT: JSON.stringify(options.stubScript),
      ORCA: `${process.execPath} ${ORCA_DEV_CLI}`
    },
    userDataDir
  })
  // Why ORCA_DEV_USER_DATA_PATH: orca-dev.mjs resolves the runtime metadata from it, so the
  // serve process, this test's CLI calls, and the stub's worker_done all reach one runtime.
  const env = { ...isolation.env, ORCA_DEV_USER_DATA_PATH: userDataDir }

  let serveOutput = ''
  const serve = spawnProcess({
    program: process.execPath,
    args: [ORCA_DEV_CLI, 'serve', '--no-pairing', '--json', '--port', '0'],
    env,
    detached: true
  })
  serve.stdout.on('data', (chunk: Buffer) => {
    serveOutput += chunk.toString()
  })
  serve.stderr.on('data', (chunk: Buffer) => {
    serveOutput += chunk.toString()
  })

  async function cli<TResult>(
    args: string[],
    cliOptions: { cwd?: string; timeoutMs?: number } = {}
  ): Promise<TResult> {
    const result = await runProcess({
      program: process.execPath,
      args: [ORCA_DEV_CLI, ...args, '--json'],
      cwd: cliOptions.cwd ?? REPO_ROOT,
      env,
      timeoutMs: cliOptions.timeoutMs ?? 30_000
    })
    const envelope = parseEnvelope<TResult>(result.stdout)
    if (!envelope?.ok) {
      throw new Error(
        `orca ${args.join(' ')} failed (exit ${result.code}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      )
    }
    return envelope.result
  }

  async function dispose(): Promise<void> {
    await signalProcessTree(serve, 'SIGTERM')
    if (!(await waitForExit(serve, SERVE_EXIT_TIMEOUT_MS))) {
      await forceTerminateProcessTree(serve)
    }
    // Why: quit leaves daemon-hosted PTYs (the stub workers) alive for warm reattach.
    await cleanupE2EDaemons(userDataDir)
    rmSync(userDataDir, { recursive: true, force: true })
  }

  const deadline = Date.now() + READY_TIMEOUT_MS
  let lastError: unknown = null
  while (Date.now() < deadline) {
    if (serve.exitCode !== null) {
      break
    }
    try {
      const status = await cli<{ runtime: { reachable: boolean } }>(['status'])
      if (status.runtime.reachable) {
        return { cli, dispose }
      }
      lastError = new Error(`status: ${JSON.stringify(status)}`)
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  await dispose()
  throw new Error(
    `Headless Orca runtime was not reachable within ${READY_TIMEOUT_MS}ms.\n` +
      `${lastError instanceof Error ? lastError.message : ''}\nserve output:\n${serveOutput}`
  )
}
