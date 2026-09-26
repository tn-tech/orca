import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'

// The executing host's plugin state; the real port would read ~/.claude on this machine.
const host = vi.hoisted(() => {
  const installs: string[] = []
  return { installed: new Set<string>(), installs }
})

vi.mock('./workflow-plugin-install', () => ({
  createWorkflowPluginPort: () => ({
    isInstalled: async ({ plugin }: { plugin: string }) => host.installed.has(plugin),
    unavailableReason: () => undefined,
    install: async ({ plugin }: { plugin: string }) => {
      host.installs.push(plugin)
      host.installed.add(plugin)
      return { ok: true }
    }
  })
}))

import {
  createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'
import { decideSourceTrust } from './workflow-source-trust'

const SOURCE = 'acme-decks@acme'

/** `implement` needs a plugin skill; `review` does not. */
const PLUGIN_WORKFLOW: Workflow = {
  ...TWO_NODE_WORKFLOW,
  roles: {
    ...TWO_NODE_WORKFLOW.roles,
    developer: {
      ...TWO_NODE_WORKFLOW.roles.developer,
      agent: 'claude',
      skills: [{ name: 'deck-writer', source: { kind: 'plugin', plugin: SOURCE }, required: true }]
    }
  }
}

/** `implement` (plugin skill) and `review` (none) both start from Start. */
const PARALLEL_PLUGIN_WORKFLOW: Workflow = {
  ...PLUGIN_WORKFLOW,
  edges: [
    { id: 'e1', from: 'start', to: 'implement' },
    { id: 'e2', from: 'start', to: 'review' },
    { id: 'e3', from: 'review', to: 'end' }
  ]
}

describe('WorkflowRunController — plugin source trust (FR-018a, US4 AS4a)', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-controller-trust-'))
    h = createControllerHarness(workspaceRoot)
    host.installed.clear()
    host.installs.length = 0
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    h.db.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  const implementOf = (runId: string) =>
    h.db.listWorkflowAttempts(runId).filter((attempt) => attempt.nodeId === 'implement')

  function decide(decision: 'trusted' | 'refused'): string[] {
    return decideSourceTrust(h.db, h.runtime, {
      host: 'local',
      source: SOURCE,
      decision,
      decidedBy: 'tester'
    })
  }

  async function startUntilWaiting(workflow: Workflow = PLUGIN_WORKFLOW) {
    const run = h.createRun(workflow)
    const controller = h.createController(run.id)
    const finished = controller.run()
    await waitUntil(() => implementOf(run.id)[0]?.state === 'waiting')
    return { run, controller, finished }
  }

  /** Lets the controller run until it would sleep, then proves it did nothing more. */
  async function settle(): Promise<void> {
    for (let spins = 0; spins < 200; spins += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }

  it('waits on a trust question, then installs and launches once the source is trusted', async () => {
    const { run, controller, finished } = await startUntilWaiting()

    const [question] = h.db.listPendingWorkflowQuestions(run.id)
    expect(question).toMatchObject({ kind: 'trust', attemptId: implementOf(run.id)[0].id })
    expect(question.prompt).toContain(SOURCE)
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('waiting')
    expect(h.workerHandles).toEqual([])
    expect(host.installs).toEqual([])

    expect(decide('trusted')).toEqual([run.id])
    controller.wake()
    await waitUntil(() => h.workerHandles.length === 1)

    expect(host.installs).toEqual([SOURCE])
    expect(implementOf(run.id)).toHaveLength(1)
    expect(implementOf(run.id)[0].state).toBe('running')
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('running')
    expect(h.db.listPendingWorkflowQuestions(run.id)).toEqual([])
    controller.stop()
    await finished
  })

  it('fails the node without installing when the source is refused', async () => {
    const { run, controller, finished } = await startUntilWaiting()

    decide('refused')
    controller.wake()
    await waitUntil(() => h.db.getWorkflowRun(run.id)?.state === 'failed')
    await finished

    expect(implementOf(run.id)[0].state).toBe('failed')
    expect(implementOf(run.id)[0].failureReason).toContain('not trusted')
    expect(host.installs).toEqual([])
    expect(h.workerHandles).toEqual([])
  })

  it('does not ask again on a later run on the same host', async () => {
    decide('trusted')
    const run = h.createRun(PLUGIN_WORKFLOW)
    const controller = h.createController(run.id)
    const finished = controller.run()

    await waitUntil(() => h.workerHandles.length === 1)
    expect(h.db.listWorkflowQuestions(run.id)).toEqual([])
    expect(host.installs).toEqual([SOURCE])
    controller.stop()
    await finished
  })

  it('keeps other nodes running while one node waits for trust', async () => {
    const { run, controller, finished } = await startUntilWaiting(PARALLEL_PLUGIN_WORKFLOW)

    await waitUntil(() => h.workerHandles.length === 1)
    const review = h.db.listWorkflowAttempts(run.id).find((a) => a.nodeId === 'review')
    expect(review?.state).toBe('running')
    expect(implementOf(run.id)[0].state).toBe('waiting')
    controller.stop()
    await finished
  })

  it('keeps waiting across a restart, and resumes exactly once from an answer made while down', async () => {
    const first = await startUntilWaiting()
    first.controller.stop()
    await first.finished

    const second = h.createController(first.run.id)
    const secondFinished = second.run()
    await settle()
    expect(implementOf(first.run.id)[0].state).toBe('waiting')
    expect(h.workerHandles).toEqual([])
    second.stop()
    await secondFinished

    // Answered while no controller runs: nothing is woken, the next controller catches up.
    decide('trusted')
    const third = h.createController(first.run.id)
    const thirdFinished = third.run()
    await waitUntil(() => h.workerHandles.length === 1)
    await settle()

    expect(h.workerHandles).toHaveLength(1)
    expect(implementOf(first.run.id)).toHaveLength(1)
    expect(implementOf(first.run.id)[0].state).toBe('running')
    expect(host.installs).toEqual([SOURCE])
    third.stop()
    await thirdFinished
  })
})
