/**
 * T075 / SC-006: runs feature-with-qa.workflow.yaml (start -> plan -> approve-plan -> Loop{
 * implement -> review, maxIterations 3} -> end) end to end through `orca workflows run` on the
 * headless runtime. The test answers the Approval the way a paired client does
 * (`orca workflows answer` -> `workflow.run.answer`), then checks three loop iterations in
 * `workflow.run.show` and that the loop's first agent started within 5 s of the answer.
 *
 * Why a separate file from two-node-run.e2e.test.ts: each file owns one headless runtime, and
 * both flows together would pass the 300-line limit.
 *
 * Run with `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:workflows:e2e` (builds out/ first).
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'
import type {
  NodeAttemptView,
  RunEventView,
  RunQuestionView,
  RunSnapshot
} from '../../../src/shared/workflows/workflow-run-types'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { createSampleWorkflowRepo } from '../../fixtures/workflows/create-sample-repo'
import {
  launchHeadlessWorkflowRuntime,
  missingBuiltEntryPoints,
  type HeadlessWorkflowRuntime,
  type StubAgentScript
} from './headless-workflow-runtime'

type RunView = RunSnapshot & {
  attempts: NodeAttemptView[]
  questions: RunQuestionView[]
  events: RunEventView[]
}

const FEATURE_WITH_QA_FIXTURE = join(
  __dirname,
  '../../fixtures/workflows/feature-with-qa.workflow.yaml'
)
const RESUME_BUDGET_MS = 5_000
const POLL_INTERVAL_MS = 250
const POLL_TIMEOUT_MS = 120_000

const finding = (n: number) => ({ title: `issue ${n}`, severity: 'major' })
const reject = (n: number) => ({ approved: false, findings: [finding(n)] })
const approve = { approved: true, findings: [] }
const PLAN_RESULT = { planPath: 'specs/greeting/plan.md' }

const STUB_SCRIPT: StubAgentScript = {
  plan: { '0': { result: PLAN_RESULT } },
  implement: {
    '0': { result: { summary: 'pass 0', commits: [] } },
    '1': { result: { summary: 'pass 1', commits: [] } },
    '2': { result: { summary: 'pass 2', commits: [] } }
  },
  review: {
    '0': { result: reject(0) },
    '1': { result: reject(1) },
    '2': { result: approve }
  }
}

/**
 * The contract fixture minus what cannot run hermetically: role skills (a GitHub clone via
 * `npx skills add` plus a plugin install) and Plan's `specs/**\/plan.md` artifact (the stub
 * writes only result.json). The graph, Approval and Loop are unchanged.
 */
function hermeticFeatureWithQa(): string {
  const doc = parseDocument(readFileSync(FEATURE_WITH_QA_FIXTURE, 'utf8'))
  for (const roleId of ['planner', 'developer', 'reviewer']) {
    doc.setIn(['roles', roleId, 'skills'], doc.createNode([]))
  }
  const nodeIds: unknown[] = doc.toJS().nodes.map((node: { id: unknown }) => node.id)
  doc.setIn(['nodes', nodeIds.indexOf('plan'), 'artifacts'], doc.createNode([]))
  return doc.toString()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

/** Polls `workflow.run.show` until `pick` returns a value; fails fast if the run ends first. */
async function pollRunView<T>(
  runtime: HeadlessWorkflowRuntime,
  runId: string,
  label: string,
  pick: (view: RunView) => T | undefined
): Promise<T> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const view = await runtime.cli<RunView>(['workflows', 'status', '--run-id', runId])
    const picked = pick(view)
    if (picked !== undefined) {
      return picked
    }
    if (['completed', 'failed', 'cancelled'].includes(view.state)) {
      throw new Error(`Run ended ${view.state} before ${label}: ${JSON.stringify(view)}`)
    }
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`Run ${runId} did not reach ${label} within ${POLL_TIMEOUT_MS}ms`)
}

function eventFor(view: RunView, kind: string, nodeId?: string): RunEventView | undefined {
  return view.events.find(
    (event) =>
      event.kind === kind &&
      (nodeId === undefined ||
        (typeof event.payloadJson === 'object' &&
          event.payloadJson !== null &&
          !Array.isArray(event.payloadJson) &&
          event.payloadJson.nodeId === nodeId &&
          event.payloadJson.iteration === 0))
  )
}

// Why POSIX only: the stub reports status through the managed `<agent>-hook.sh` script, the
// same path a real CLI's hooks take; the Windows hook shim is a `.cmd` the stub does not drive.
describe.skipIf(process.platform === 'win32')(
  'feature-with-qa workflow run (stub agent e2e)',
  () => {
    let runtime: HeadlessWorkflowRuntime
    let repoPath: string
    let approval: RunQuestionView
    let answerReturnedAtMs: number
    // `workflow.run.show` returns only the last 50 events, so the resume is read soon after it.
    let resumedView: RunView
    let view: RunView

    beforeAll(async () => {
      const missing = missingBuiltEntryPoints()
      if (missing.length > 0) {
        throw new Error(
          `Build first (pnpm run build:cli && pnpm run build:electron-vite); missing: ${missing.join(', ')}`
        )
      }
      ;({ repoPath } = await createSampleWorkflowRepo())
      writeFileSync(
        join(repoPath, 'orca-workflows', 'feature-with-qa.workflow.yaml'),
        hermeticFeatureWithQa()
      )
      for (const args of [
        ['add', '-A'],
        ['commit', '-m', 'Add feature-with-qa workflow']
      ]) {
        const git = await runProcess({ program: 'git', args, cwd: repoPath })
        expect(git.code, git.stderr).toBe(0)
      }

      runtime = await launchHeadlessWorkflowRuntime({ stubScript: STUB_SCRIPT })
      await runtime.cli(['repo', 'add', '--path', repoPath])
      // `workflows run` resolves its repo from the enclosing worktree, like a user in a shell.
      const { runId } = await runtime.cli<{ runId: string }>(
        ['workflows', 'run', '--name', 'feature-with-qa', '--objective', 'Add a greeting'],
        { cwd: repoPath }
      )
      approval = await pollRunView(runtime, runId, 'a pending approval', (candidate) =>
        candidate.questions.find(
          (question) => question.kind === 'approval' && question.state === 'pending'
        )
      )
      await runtime.cli([
        'workflows',
        'answer',
        '--run-id',
        runId,
        '--question-id',
        approval.id,
        '--option',
        'approve'
      ])
      answerReturnedAtMs = Date.now()
      resumedView = await pollRunView(
        runtime,
        runId,
        "the loop's first agent launch",
        (candidate) =>
          eventFor(candidate, 'attempt_provisioning', 'implement') ? candidate : undefined
      )
      view = await runtime.cli<RunView>(['workflows', 'status', '--run-id', runId, '--wait'], {
        timeoutMs: 150_000
      })
    }, 240_000)

    afterAll(async () => {
      await runtime?.dispose()
      if (repoPath) {
        rmSync(repoPath, { recursive: true, force: true })
      }
    }, 60_000)

    function attemptsFor(nodeId: string): NodeAttemptView[] {
      return view.attempts
        .filter((attempt) => attempt.nodeId === nodeId)
        .sort((a, b) => a.iteration - b.iteration)
    }

    it('records the approval answer and routes the run down its approve port', () => {
      expect(view.questions.find((question) => question.id === approval.id)).toMatchObject({
        kind: 'approval',
        state: 'answered',
        answer: 'approve'
      })
      expect(attemptsFor('plan')).toEqual([
        expect.objectContaining({ state: 'completed', resultJson: PLAN_RESULT })
      ])
      expect(attemptsFor('approve-plan')).toEqual([
        expect.objectContaining({ state: 'completed', resultJson: { option: 'approve' } })
      ])
    })

    it('runs three loop iterations with per-iteration results on workflow.run.show', () => {
      expect(view.state).toBe('completed')
      expect(
        attemptsFor('implement').map((a) => ({
          iteration: a.iteration,
          state: a.state,
          resultJson: a.resultJson
        }))
      ).toEqual(
        [0, 1, 2].map((iteration) => ({
          iteration,
          state: 'completed',
          resultJson: { summary: `pass ${iteration}`, commits: [] }
        }))
      )
      expect(
        attemptsFor('review').map((a) => ({
          iteration: a.iteration,
          state: a.state,
          resultJson: a.resultJson
        }))
      ).toEqual([
        { iteration: 0, state: 'completed', resultJson: reject(0) },
        { iteration: 1, state: 'completed', resultJson: reject(1) },
        { iteration: 2, state: 'completed', resultJson: approve }
      ])
      expect(attemptsFor('qa-loop')).toEqual([
        expect.objectContaining({
          state: 'completed',
          resultJson: { iterations: 3, exitResult: approve }
        })
      ])
      expect(attemptsFor('end')).toEqual([expect.objectContaining({ state: 'completed' })])
    })

    // SC-006, all on the runtime's ms clock (no cross-clock skew): from the recorded answeredAt,
    // which precedes the answer RPC's return, so this over-counts, to the run leaving `waiting`,
    // the downstream Loop's attempt starting, and its first agent's launch beginning. The agent
    // CLI's own boot (provisioning -> running) is launch cost every agent node pays, not resume.
    it('resumes the run within 5 s of the approval answer', () => {
      const answeredAtMs = Date.parse(
        view.questions.find((question) => question.id === approval.id)?.answeredAt ?? ''
      )
      expect(answeredAtMs).toBeLessThanOrEqual(answerReturnedAtMs)
      const msAfterAnswer = (timestamp: string | undefined): number =>
        Date.parse(timestamp ?? '') - answeredAtMs
      expect(
        eventFor(resumedView, 'approval_answered'),
        'resume inside the event tail'
      ).toBeDefined()
      const resumeDelays = {
        runResumed: msAfterAnswer(eventFor(resumedView, 'run_resumed')?.createdAt),
        loopStarted: msAfterAnswer(attemptsFor('qa-loop')[0]?.startedAt),
        firstAgentLaunching: msAfterAnswer(
          eventFor(resumedView, 'attempt_provisioning', 'implement')?.createdAt
        )
      }
      for (const [label, delayMs] of Object.entries(resumeDelays)) {
        expect(delayMs, label).toBeGreaterThanOrEqual(0)
        expect(delayMs, label).toBeLessThan(RESUME_BUDGET_MS)
      }
    })
  }
)
