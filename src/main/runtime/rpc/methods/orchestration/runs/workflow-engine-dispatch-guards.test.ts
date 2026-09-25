import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../../../orca-runtime'
import { OrchestrationDb } from '../../../../orchestration/db'
import { eraseRpcMethods, type RpcContext } from '../../../core'
import { ORCHESTRATION_METHODS } from '../../orchestration'
import type { WorkflowEnginePrincipal } from '../../../../workflows/workflow-engine-principal'

const COORDINATOR_PANE_KEY = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const GUARDED = [
  'orchestration.workerStop',
  'orchestration.workerRelease',
  'orchestration.workerRetain',
  'orchestration.workerAbandon'
] as const

describe('dispatch-keyed verbs and reset on engine-owned Runs', () => {
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let workflowRunId: string
  let engineDispatchId: string
  let terminalDispatchId: string
  let engine: WorkflowEnginePrincipal

  function dispatchIn(runId: string, assigneeHandle: string): string {
    const task = db.createTask({ spec: 'work', runId })
    return db.createDispatchContext({
      taskId: task.id,
      assigneeHandle,
      creator: { kind: 'system' },
      maxDepth: 4
    }).id
  }

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue(null)
    workflowRunId = db.createWorkflowRun({
      workflowName: 'two-node',
      workflowSource: 'project',
      workflowSnapshot: {
        version: 1,
        name: 'two-node',
        workspacePolicy: 'run-workspace',
        roles: {},
        nodes: [],
        edges: [],
        layout: {}
      },
      workflowVersion: '1',
      objective: 'engine run',
      repoId: 'repo',
      worktreeId: 'repo::run'
    }).id
    const engineRun = db.createWorkflowEngineRun({ workflowRunId, objective: 'engine run' })
    const terminalRun = db.createRun({
      objective: 'terminal run',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: COORDINATOR_PANE_KEY
    })
    engineDispatchId = dispatchIn(engineRun.id, 'term_engine_worker')
    terminalDispatchId = dispatchIn(terminalRun.id, 'term_worker')
    engine = { kind: 'workflow-engine', workflowRunId }
  })

  afterEach(() => {
    db.close()
  })

  async function outcome(name: string, params: Record<string, unknown>, ctx: Partial<RpcContext>) {
    const method = eraseRpcMethods(ORCHESTRATION_METHODS).find((m) => m.name === name)
    if (!method?.params) {
      throw new Error(`${name} is not registered`)
    }
    const parsed = method.params.parse(params)
    try {
      return { ok: await method.handler(parsed, { runtime, ...ctx }) }
    } catch (error) {
      return { error }
    }
  }

  it.each(GUARDED)('%s refuses a terminal caller on an engine-owned Run', async (name) => {
    const before = db.getDispatchContextById(engineDispatchId)
    const result = await outcome(name, { dispatch: engineDispatchId }, {})
    expect(result).toMatchObject({ error: { code: 'workflow_owned_run' } })
    expect(db.getDispatchContextById(engineDispatchId)).toEqual(before)
  })

  it.each(GUARDED)('%s leaves ordinary Runs to the existing checks', async (name) => {
    const result = await outcome(name, { dispatch: terminalDispatchId }, {})
    expect(result).not.toMatchObject({ error: { code: 'workflow_owned_run' } })
  })

  it('lets the engine principal stop its own workers but not another Run’s', async () => {
    const own = await outcome(
      'orchestration.workerStop',
      { dispatch: engineDispatchId },
      { principal: engine }
    )
    expect(own).not.toMatchObject({ error: { code: 'workflow_owned_run' } })
    expect(own).not.toMatchObject({ error: { code: 'consumer_fenced' } })
    const foreign = await outcome(
      'orchestration.workerStop',
      { dispatch: terminalDispatchId },
      { principal: engine }
    )
    expect(foreign).toMatchObject({ error: { code: 'consumer_fenced' } })
  })

  it('refuses reset while an engine-owned workflow run is active', async () => {
    for (const scope of ['all', 'tasks', 'messages']) {
      const result = await outcome('orchestration.reset', { [scope]: true }, {})
      expect(result).toMatchObject({
        error: {
          code: 'workflow_owned_run',
          message: expect.stringContaining(`orca workflows cancel ${workflowRunId}`)
        }
      })
    }
    expect(db.getRunForWorkflowRun(workflowRunId)).toBeDefined()
  })

  it('allows reset once the workflow run is finished', async () => {
    db.transitionWorkflowRun(workflowRunId, 'cancelled')
    expect(await outcome('orchestration.reset', { tasks: true }, {})).toEqual({
      ok: { reset: 'tasks' }
    })
  })
})
