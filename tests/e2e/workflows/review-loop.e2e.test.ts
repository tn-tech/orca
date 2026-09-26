/**
 * T075 / spec.md User Story 2 independent test: runs review-loop.workflow.yaml (start -> Loop{
 * implement -> review, entry implement, exit review, maxIterations 3, exitCondition
 * review.approved truthy} -> end) end to end through `orca workflows run` on the headless runtime
 * (SC-003). Loop-only fixture: feature-with-qa.workflow.yaml's Approval node is US5, not
 * implemented yet, so its T075/SC-006 approval-answer coverage is deferred to that phase.
 *
 * Run with `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:workflows:e2e` (builds out/ first).
 */
import { copyFileSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

const REVIEW_LOOP_FIXTURE = join(__dirname, '../../fixtures/workflows/review-loop.workflow.yaml')

const reject = (n: number) => ({ approved: false, findings: [`issue ${n}`] })
const approve = { approved: true, findings: [] }

async function runReviewLoop(reviewScript: Record<string, { result: unknown }>): Promise<{
  runtime: HeadlessWorkflowRuntime
  repoPath: string
  runId: string
  status: RunStatus
}> {
  const missing = missingBuiltEntryPoints()
  if (missing.length > 0) {
    throw new Error(
      `Build first (pnpm run build:cli && pnpm run build:electron-vite); missing: ${missing.join(', ')}`
    )
  }
  const { repoPath } = await createSampleWorkflowRepo()
  copyFileSync(REVIEW_LOOP_FIXTURE, join(repoPath, 'orca-workflows', 'review-loop.workflow.yaml'))
  for (const args of [
    ['add', '-A'],
    ['commit', '-m', 'Add review-loop workflow']
  ]) {
    const git = await runProcess({ program: 'git', args, cwd: repoPath })
    expect(git.code, git.stderr).toBe(0)
  }

  const stubScript: StubAgentScript = {
    implement: {
      '0': { result: { summary: 'pass 0' } },
      '1': { result: { summary: 'pass 1' } },
      '2': { result: { summary: 'pass 2' } }
    },
    review: reviewScript
  }
  const runtime = await launchHeadlessWorkflowRuntime({ stubScript })
  await runtime.cli(['repo', 'add', '--path', repoPath])
  // `workflows run` resolves its repo from the enclosing worktree, like a user in a shell.
  const { runId } = await runtime.cli<{ runId: string }>(
    ['workflows', 'run', '--name', 'review-loop', '--objective', 'Add a greeting'],
    { cwd: repoPath }
  )
  const status = await runtime.cli<RunStatus>(
    ['workflows', 'status', '--run-id', runId, '--wait'],
    {
      timeoutMs: 150_000
    }
  )
  return { runtime, repoPath, runId, status }
}

async function worktreePath(runtime: HeadlessWorkflowRuntime, worktreeId: string): Promise<string> {
  const { worktrees } = await runtime.cli<{ worktrees: RuntimeWorktreePsSummary[] }>([
    'worktree',
    'ps'
  ])
  const worktree = worktrees.find((candidate) => candidate.worktreeId === worktreeId)
  expect(worktree, `worktree ${worktreeId} in ps`).toBeDefined()
  return worktree?.path ?? ''
}

async function cleanup(runtime: HeadlessWorkflowRuntime, repoPath: string): Promise<void> {
  await runtime.dispose()
  rmSync(repoPath, { recursive: true, force: true })
}

// Why POSIX only: the stub reports status through the managed `<agent>-hook.sh` script, the
// same path a real CLI's hooks take; the Windows hook shim is a `.cmd` the stub does not drive.
describe.skipIf(process.platform === 'win32')('review-loop workflow run (stub agent e2e)', () => {
  describe('reviewer rejects twice then approves', () => {
    let runtime: HeadlessWorkflowRuntime
    let repoPath: string
    let status: RunStatus

    beforeAll(async () => {
      ;({ runtime, repoPath, status } = await runReviewLoop({
        '0': { result: reject(0) },
        '1': { result: reject(1) },
        '2': { result: approve }
      }))
    }, 240_000)

    afterAll(() => cleanup(runtime, repoPath), 60_000)

    function attemptsFor(nodeId: string): NodeAttemptView[] {
      return status.attempts
        .filter((attempt) => attempt.nodeId === nodeId)
        .sort((a, b) => a.iteration - b.iteration)
    }

    it('runs three iterations and completes the run on approval', () => {
      expect(status.state).toBe('completed')
      expect(
        attemptsFor('implement').map((a) => ({ iteration: a.iteration, state: a.state }))
      ).toEqual([0, 1, 2].map((iteration) => ({ iteration, state: 'completed' })))
      expect(
        attemptsFor('review').map((a) => ({ iteration: a.iteration, resultJson: a.resultJson }))
      ).toEqual([
        { iteration: 0, resultJson: reject(0) },
        { iteration: 1, resultJson: reject(1) },
        { iteration: 2, resultJson: approve }
      ])
    })

    it('exposes each iteration on the run view, and settles the Loop attempt on exit', () => {
      const loopAttempts = attemptsFor('review-loop')
      expect(loopAttempts).toHaveLength(1)
      expect(loopAttempts[0]).toMatchObject({
        state: 'completed',
        resultJson: { iterations: 3, exitResult: approve }
      })
      expect(attemptsFor('end')[0]).toMatchObject({ state: 'completed' })
    })

    it('feeds Implement the previous iteration findings via loop.previous', async () => {
      const path = await worktreePath(runtime, status.worktreeId ?? '')
      const thirdImplement = attemptsFor('implement')[2]
      const attemptDir = dirname(thirdImplement.resultPath ?? '')
      const inputs = JSON.parse(readFileSync(join(path, attemptDir, 'inputs.json'), 'utf8'))
      expect(inputs).toMatchObject({
        nodeId: 'implement',
        iteration: 2,
        loopPrevious: { review: { result: reject(1) } }
      })
      const brief = readFileSync(join(path, thirdImplement.briefPath ?? ''), 'utf8')
      expect(brief).toContain('Previous review findings, if any: ["issue 1"]')
    })
  })

  describe('reviewer never approves', () => {
    let runtime: HeadlessWorkflowRuntime
    let repoPath: string
    let status: RunStatus

    beforeAll(async () => {
      ;({ runtime, repoPath, status } = await runReviewLoop({
        '0': { result: reject(0) },
        '1': { result: reject(1) },
        '2': { result: reject(2) }
      }))
    }, 240_000)

    afterAll(() => cleanup(runtime, repoPath), 60_000)

    function attemptsFor(nodeId: string): NodeAttemptView[] {
      return status.attempts.filter((attempt) => attempt.nodeId === nodeId)
    }

    it('fails the run with loop_cap_reached after the third iteration, keeping the last findings', () => {
      expect(status.state).toBe('failed')
      expect(attemptsFor('implement')).toHaveLength(3)
      expect(attemptsFor('review')).toHaveLength(3)
      const loopAttempts = attemptsFor('review-loop')
      expect(loopAttempts).toHaveLength(1)
      expect(loopAttempts[0]).toMatchObject({
        state: 'failed',
        failureReason: 'loop_cap_reached',
        resultJson: { iterations: 3, exitResult: reject(2) }
      })
      expect(attemptsFor('end')[0]).toMatchObject({ state: 'skipped' })
    })
  })
})
