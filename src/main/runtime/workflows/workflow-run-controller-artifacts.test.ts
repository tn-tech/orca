import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARTIFACT_GLOB_MAX_DEPTH } from './workflow-artifact-glob'
import { localWorkflowFilesystem } from './workflow-file-store-filesystem'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import {
  createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

/** `implement` declares a required artifact glob; `review` reads what it matched. */
function globArtifactWorkflow(pattern = 'specs/**/plan.md'): Workflow {
  return {
    ...TWO_NODE_WORKFLOW,
    nodes: TWO_NODE_WORKFLOW.nodes.map((node) => {
      if (node.type === 'agent' && node.id === 'implement') {
        return { ...node, artifacts: [{ path: pattern, required: true }] }
      }
      if (node.type === 'agent' && node.id === 'review') {
        return { ...node, prompt: 'Review ${upstream.implement.artifacts}.' }
      }
      return node
    })
  }
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

  async function touch(relativePath: string): Promise<void> {
    await mkdir(join(workspaceRoot, dirname(relativePath)), { recursive: true })
    await writeFile(join(workspaceRoot, relativePath), 'x', 'utf-8')
  }

  async function reportImplementDone(runId: string): Promise<void> {
    const implement = attempt(runId, 'implement')
    await h.writeResult(implement?.resultPath ?? '', { summary: 'done' })
    await h.sendWorkerDone({
      handle: h.workerHandles[0] ?? '',
      taskId: implement?.taskId ?? '',
      dispatchId: implement?.dispatchId ?? '',
      reportPath: implement?.resultPath ?? ''
    })
  }

  const deepPath = (leaf: string) =>
    [...Array.from({ length: ARTIFACT_GLOB_MAX_DEPTH }, (_, i) => `d${i}`), leaf].join('/')

  it('records artifact_glob_truncated when a capped walk still found the artifact', async () => {
    const run = h.createRun(globArtifactWorkflow('**/plan.md'))
    const controller = h.createController(run.id)
    const finished = controller.run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    await touch('specs/plan.md')
    await touch(deepPath('plan.md'))
    await reportImplementDone(run.id)
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')

    const events = h.db
      .listWorkflowEvents(run.id)
      .filter((e) => e.kind === 'artifact_glob_truncated')
    expect(events).toMatchObject([
      {
        attemptId: attempt(run.id, 'implement')?.id,
        payloadJson: { pattern: '**/plan.md', reason: 'depth' }
      }
    ])
    controller.stop()
    await finished
  })

  it('fails the node with the truncation reason as detail when a capped walk found nothing', async () => {
    const run = h.createRun(globArtifactWorkflow('**/plan.md'))
    const finished = h.createController(run.id).run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    await touch(deepPath('plan.md'))
    await reportImplementDone(run.id)
    await expect(finished).resolves.toBe('failed')

    expect(attempt(run.id, 'implement')).toMatchObject({
      state: 'failed',
      failureReason: 'artifact_missing'
    })
    const failed = h.db
      .listWorkflowEvents(run.id)
      .find((e) => JSON.stringify(e.payloadJson).includes('stopped early'))
    expect(JSON.stringify(failed?.payloadJson)).toContain('(depth)')
  })

  it('leaves the report unsettled for the next controller when stopped mid-walk', async () => {
    const run = h.createRun(globArtifactWorkflow())
    const controller = h.createController(run.id)
    const finished = controller.run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    await touch('specs/001-feature/plan.md')
    const realReadDir = localWorkflowFilesystem.readDir
    const readDir = vi.spyOn(localWorkflowFilesystem, 'readDir').mockImplementation((dir) => {
      controller.stop()
      return realReadDir(dir)
    })
    await reportImplementDone(run.id)
    await expect(finished).resolves.toBe('running')
    expect(attempt(run.id, 'implement')?.state).toBe('running')

    readDir.mockRestore()
    const resumed = h.createController(run.id)
    const resumedRun = resumed.run()
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')
    expect(attempt(run.id, 'implement')).toMatchObject({
      state: 'completed',
      artifactsJson: [{ path: 'specs/001-feature/plan.md', exists: true }]
    })
    resumed.stop()
    await resumedRun
  })

  it('gives the downstream brief and inputs.json the concrete matched paths', async () => {
    const run = h.createRun(globArtifactWorkflow())
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
