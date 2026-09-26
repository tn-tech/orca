import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import {
  createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

/** `implement` runs in a child workspace and its role needs a repository skill. */
const CHILD_WITH_REPOSITORY_SKILL: Workflow = {
  ...TWO_NODE_WORKFLOW,
  roles: {
    ...TWO_NODE_WORKFLOW.roles,
    developer: {
      ...TWO_NODE_WORKFLOW.roles.developer,
      skills: [
        {
          name: 'model-review',
          source: { kind: 'repository', location: 'https://github.com/acme/skills' },
          required: true
        }
      ]
    }
  },
  nodes: TWO_NODE_WORKFLOW.nodes.map((node) =>
    node.type === 'agent' && node.id === 'implement' ? { ...node, workspace: 'child' } : node
  )
}

describe('WorkflowRunController — child placement with repository skills', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-controller-skills-'))
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

  it('fails the node before any worker starts, suggesting run-workspace placement', async () => {
    const run = h.createRun(CHILD_WITH_REPOSITORY_SKILL)
    const finished = h.createController(run.id).run()

    await waitUntil(() => h.db.getWorkflowRun(run.id)?.state === 'failed')
    await finished
    const implement = h.db
      .listWorkflowAttempts(run.id)
      .find((attempt) => attempt.nodeId === 'implement')
    expect(implement?.state).toBe('failed')
    expect(implement?.failureReason).toContain('child workspace')
    expect(implement?.failureReason).toContain('run workspace instead')
    expect(h.workerHandles).toEqual([])
  })
})
