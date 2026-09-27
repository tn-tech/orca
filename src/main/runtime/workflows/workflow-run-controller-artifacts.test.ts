import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import {
  createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

/** `implement` declares a required artifact glob; `review` reads what it matched. */
const GLOB_ARTIFACT_WORKFLOW: Workflow = {
  ...TWO_NODE_WORKFLOW,
  nodes: TWO_NODE_WORKFLOW.nodes.map((node) => {
    if (node.type === 'agent' && node.id === 'implement') {
      return { ...node, artifacts: [{ path: 'specs/**/plan.md', required: true }] }
    }
    if (node.type === 'agent' && node.id === 'review') {
      return { ...node, prompt: 'Review ${upstream.implement.artifacts}.' }
    }
    return node
  })
}

describe('WorkflowRunController — artifact globs flow downstream', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-controller-artifacts-'))
    h = createControllerHarness(workspaceRoot)
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

  const attempt = (runId: string, nodeId: string) =>
    h.db.listWorkflowAttempts(runId).find((candidate) => candidate.nodeId === nodeId)

  it('gives the downstream brief and inputs.json the concrete matched paths', async () => {
    const run = h.createRun(GLOB_ARTIFACT_WORKFLOW)
    const finished = h.createController(run.id).run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')

    await mkdir(join(workspaceRoot, 'specs/001-feature'), { recursive: true })
    await writeFile(join(workspaceRoot, 'specs/001-feature/plan.md'), '# plan', 'utf-8')
    const implement = attempt(run.id, 'implement')
    await h.writeResult(implement?.resultPath ?? '', { summary: 'done' })
    await h.sendWorkerDone({
      handle: h.workerHandles[0] ?? '',
      taskId: implement?.taskId ?? '',
      dispatchId: implement?.dispatchId ?? '',
      reportPath: implement?.resultPath ?? ''
    })
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')

    expect(attempt(run.id, 'implement')?.artifactsJson).toEqual([
      { path: 'specs/001-feature/plan.md', exists: true }
    ])
    const review = attempt(run.id, 'review')
    const reviewDir = join(workspaceRoot, dirname(review?.briefPath ?? ''))
    const inputs = JSON.parse(await readFile(join(reviewDir, 'inputs.json'), 'utf-8'))
    expect(inputs.upstream.implement.artifacts).toEqual(['specs/001-feature/plan.md'])
    const brief = await readFile(join(reviewDir, 'brief.md'), 'utf-8')
    expect(brief).toContain('Review ["specs/001-feature/plan.md"].')

    await h.writeResult(review?.resultPath ?? '', { verdict: 'ok' })
    await h.sendWorkerDone({
      handle: h.workerHandles[1] ?? '',
      taskId: review?.taskId ?? '',
      dispatchId: review?.dispatchId ?? '',
      reportPath: review?.resultPath ?? ''
    })
    await expect(finished).resolves.toBe('completed')
  })
})
