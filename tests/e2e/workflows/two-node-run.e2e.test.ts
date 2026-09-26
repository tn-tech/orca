/**
 * T055 / quickstart Scenario 4 (two-node variant): runs two-node.workflow.yaml end to end through
 * `orca workflows run` on a headless runtime whose agents are the deterministic stub, then checks
 * every attempt's launch receipts and transcript reference, and that `orca worktree ps` lists the
 * workflow workers with no reader change (SC-007).
 *
 * Run with `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:workflows:e2e` (builds out/ first).
 */
import { copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RuntimeWorktreePsSummary } from '../../../src/shared/runtime-types'
import type { NodeAttemptView, RunSnapshot } from '../../../src/shared/workflows/workflow-run-types'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { createSampleWorkflowRepo } from '../../fixtures/workflows/create-sample-repo'
import {
  launchHeadlessWorkflowRuntime,
  missingBuiltEntryPoints,
  type HeadlessWorkflowRuntime,
  type StubAgentScript
} from './headless-workflow-runtime'

type RunStatus = RunSnapshot & { attempts: NodeAttemptView[] }

const TWO_NODE_FIXTURE = join(__dirname, '../../fixtures/workflows/two-node.workflow.yaml')
// Non-loop nodes run at iteration 0 (data-model.md §3).
const STUB_SCRIPT: StubAgentScript = {
  implement: { '0': { result: { summary: 'Added the greeting.' } } },
  review: { '0': { result: { approved: true, findings: [] } } }
}

// Why POSIX only: the stub reports status through the managed `<agent>-hook.sh` script, the
// same path a real CLI's hooks take; the Windows hook shim is a `.cmd` the stub does not drive.
describe.skipIf(process.platform === 'win32')('two-node workflow run (stub agent e2e)', () => {
  let runtime: HeadlessWorkflowRuntime
  let repoPath: string
  let runId: string
  let status: RunStatus

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

    runtime = await launchHeadlessWorkflowRuntime({ stubScript: STUB_SCRIPT })
    await runtime.cli(['repo', 'add', '--path', repoPath])
    // `workflows run` resolves its repo from the enclosing worktree, like a user in a shell.
    ;({ runId } = await runtime.cli<{ runId: string }>(
      ['workflows', 'run', '--name', 'two-node', '--objective', 'Add a greeting'],
      { cwd: repoPath }
    ))
    status = await runtime.cli<RunStatus>(['workflows', 'status', '--run-id', runId, '--wait'], {
      timeoutMs: 150_000
    })
  }, 240_000)

  afterAll(async () => {
    await runtime?.dispose()
    if (repoPath) {
      rmSync(repoPath, { recursive: true, force: true })
    }
  }, 60_000)

  function attemptFor(nodeId: string): NodeAttemptView {
    const matches = status.attempts.filter((attempt) => attempt.nodeId === nodeId)
    expect(matches, `attempts for ${nodeId}`).toHaveLength(1)
    return matches[0]
  }

  it('completes with one completed attempt per node, in graph order', () => {
    expect(status.state).toBe('completed')
    for (const nodeId of ['start', 'implement', 'review', 'end']) {
      expect(attemptFor(nodeId)).toMatchObject({ state: 'completed', iteration: 0 })
    }
    const finishedAt = (nodeId: string): number => Date.parse(attemptFor(nodeId).finishedAt ?? '')
    const startedAt = (nodeId: string): number => Date.parse(attemptFor(nodeId).startedAt ?? '')
    expect(startedAt('review')).toBeGreaterThanOrEqual(finishedAt('implement'))
  })

  it('records the stub result and the requested and effective launch per agent node', () => {
    expect(attemptFor('implement')).toMatchObject({
      resultJson: { summary: 'Added the greeting.' },
      requestedLaunch: { agent: 'claude', model: 'opus', effort: 'high' },
      effectiveLaunch: { agent: 'claude', model: 'opus', effort: 'high' }
    })
    expect(attemptFor('review')).toMatchObject({
      resultJson: { approved: true, findings: [] },
      requestedLaunch: { agent: 'codex', model: 'gpt-5.6-terra', effort: 'high' },
      effectiveLaunch: { agent: 'codex', model: 'gpt-5.6-terra', effort: 'high' }
    })
  })

  it('gives each agent attempt a transcript reference that resolves to its worker output', async () => {
    for (const nodeId of ['implement', 'review']) {
      const attempt = attemptFor(nodeId)
      expect(attempt.dispatchId).toBeTruthy()
      expect(attempt.transcriptRef).toEqual({ kind: 'dispatch', id: attempt.dispatchId })
      const output = await runtime.cli<{ dispatchId: string; terminal?: { tail: string[] } }>([
        'orchestration',
        'worker-read',
        '--dispatch',
        attempt.transcriptRef?.id ?? ''
      ])
      expect(output.dispatchId).toBe(attempt.dispatchId)
      // The stub's `orca orchestration send --type worker_done` receipt, printed in its pane.
      expect(output.terminal?.tail.join('\n')).toMatch(/Sent msg_/)
    }
  })

  it('lists the workflow workers in `orca worktree ps` under the run worktree', async () => {
    const { worktrees } = await runtime.cli<{ worktrees: RuntimeWorktreePsSummary[] }>([
      'worktree',
      'ps'
    ])
    const runWorktree = worktrees.find((worktree) => worktree.worktreeId === status.worktreeId)
    expect(runWorktree, `worktree ${status.worktreeId} in ps`).toBeDefined()
    const workers = (runWorktree?.agents ?? []).filter(
      (agent) => agent.parentPaneKey === `workflow-engine:${runId}`
    )
    expect(
      workers.map((agent) => ({ agentType: agent.agentType, displayName: agent.displayName }))
    ).toEqual(
      expect.arrayContaining([
        { agentType: 'claude', displayName: 'Implement' },
        { agentType: 'codex', displayName: 'Review' }
      ])
    )
    expect(workers).toHaveLength(2)
  })
})
