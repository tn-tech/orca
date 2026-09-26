// FR-039: a workflow run on a Remote Orca Server must resume with no client connected, so
// rehydration must fire at boot, not only when a client first asks for the engine.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { Workflow } from '../../shared/workflows/workflow-definition-types'
import { OrchestrationDb } from './orchestration/db'
import { OrcaRuntimeService } from './orca-runtime'
import type { RuntimeStore } from './runtime-store-contract'
import { WorkflowEngine } from './workflows/workflow-engine'

const REPO: Repo = {
  id: 'repo-1',
  path: '/unused-by-an-in-place-start-end-run',
  displayName: 'Repo',
  badgeColor: '#000',
  addedAt: 0
}

// Start -> End only: settles with no worker dispatch, so this proves boot wiring without the
// heavy PTY/dispatcher fakes a run with agent nodes needs (see workflow-engine.test.ts for those).
const TRIVIAL_WORKFLOW: Workflow = {
  version: 1,
  name: 'trivial',
  workspacePolicy: 'in-place',
  roles: {},
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    { id: 'end', type: 'end', title: 'Done' }
  ],
  edges: [{ id: 'e1', from: 'start', to: 'end' }],
  layout: {}
}

/** Minimal fake covering only the `RuntimeStore` fields the constructor and `getRepo` need. */
function storeFixture(): RuntimeStore {
  return {
    getRepo: (id) => (id === REPO.id ? REPO : undefined),
    getRepos: () => [REPO],
    addRepo: () => {},
    updateRepo: () => {
      throw new Error('updateRepo is not used by this test')
    },
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined,
    setWorktreeMeta: () => {
      throw new Error('setWorktreeMeta is not used by this test')
    },
    removeWorktreeMeta: () => {},
    getGitHubCache: () => ({ pr: {}, issue: {} }),
    getSettings: () => ({
      workspaceDir: '/tmp/workspaces',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: ''
    })
  }
}

async function waitForRunState(
  db: OrchestrationDb,
  runId: string,
  state: string,
  maxTicks = 200
): Promise<void> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (db.getWorkflowRun(runId)?.state === state) {
      return
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error(`workflow run ${runId} did not reach state "${state}" in time`)
}

describe('OrcaRuntimeService.startWorkflowEngine', () => {
  it('rehydrates a run left active by a prior process as soon as it is called', async () => {
    const db = new OrchestrationDb(':memory:')
    const runtime = new OrcaRuntimeService(storeFixture())
    // Why setOrchestrationDb and not a real one: proves rehydration fires without ever letting
    // startWorkflowEngine touch the filesystem in this test.
    runtime.setOrchestrationDb(db)
    const run = db.createWorkflowRun({
      workflowName: TRIVIAL_WORKFLOW.name,
      workflowSource: 'project',
      workflowSnapshot: TRIVIAL_WORKFLOW,
      workflowVersion: 'v1',
      objective: 'boot rehydration check',
      repoId: REPO.id,
      worktreeId: REPO.id
    })
    expect(db.listActiveWorkflowRuns().map((r) => r.id)).toContain(run.id)

    runtime.startWorkflowEngine()

    await waitForRunState(db, run.id, 'completed')
    expect(runtime.getWorkflowEngine().getSnapshot(run.id)?.state).toBe('completed')

    await runtime.stopWorkflowEngine()
    db.close()
  })

  it('is idempotent: a second call rehydrates and launches a controller exactly once', async () => {
    const db = new OrchestrationDb(':memory:')
    const runtime = new OrcaRuntimeService(storeFixture())
    runtime.setOrchestrationDb(db)
    const rehydrateSpy = vi.spyOn(WorkflowEngine.prototype, 'rehydrateActiveRuns')
    const run = db.createWorkflowRun({
      workflowName: TRIVIAL_WORKFLOW.name,
      workflowSource: 'project',
      workflowSnapshot: TRIVIAL_WORKFLOW,
      workflowVersion: 'v1',
      objective: 'idempotency check',
      repoId: REPO.id,
      worktreeId: REPO.id
    })

    runtime.startWorkflowEngine()
    const engine = runtime.getWorkflowEngine()
    runtime.startWorkflowEngine()
    runtime.startWorkflowEngine()

    // Why waited on: a stray second launch would race this same run to completion twice,
    // failing on the DB's own once-only state transitions rather than looking like a no-op.
    await waitForRunState(db, run.id, 'completed')
    expect(runtime.getWorkflowEngine()).toBe(engine)
    expect(rehydrateSpy).toHaveBeenCalledTimes(1)

    await runtime.stopWorkflowEngine()
    db.close()
  })
})

const MAIN_ROOT = join(import.meta.dirname, '..')

function sourceOf(relativePath: string): string {
  return readFileSync(join(MAIN_ROOT, relativePath), 'utf8')
}

describe('every host that starts workflows wires the engine into its own boot and shutdown', () => {
  // Why not the constructor of the runtime itself: starting there would create an orchestration
  // DB for every runtime instance in the test suite. Each of these call sites is only reached
  // from that host's actual startup/shutdown path. Ordering relative to PTY/authority readiness
  // is asserted in desktop-startup-ordering.test.ts, not here — this is presence only.
  it.each([
    ['startup/main-process-runtime-launch.ts'],
    ['startup/main-process-ipc-bootstrap.ts'],
    ['orcad/orcad-entry.ts']
  ])('%s calls startWorkflowEngine', (relativePath) => {
    expect(sourceOf(relativePath)).toContain('.startWorkflowEngine()')
  })

  it.each([['startup/main-process-runtime-service.ts'], ['orcad/orcad-entry.ts']])(
    '%s calls stopWorkflowEngine on shutdown',
    (relativePath) => {
      expect(sourceOf(relativePath)).toContain('.stopWorkflowEngine()')
    }
  )
})
