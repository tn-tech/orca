import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../../../orca-runtime'
import { OrchestrationDb } from '../../../../orchestration/db'
import { eraseRpcMethods, type RpcContext } from '../../../core'
import { ORCHESTRATION_METHODS } from '../../orchestration'
import type { WorkflowEnginePrincipal } from '../../../../workflows/workflow-engine-principal'
import { createNodeTask } from '../../../../workflows/workflow-frontier-node-task'
import {
  agent,
  attempt,
  end,
  start,
  workflow
} from '../../../../workflows/workflow-frontier-test-fixtures'

describe('orchestration.taskCreate workflow link', () => {
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let engine: WorkflowEnginePrincipal
  let engineRunId: string

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue(null)
    const workflowRunId = db.createWorkflowRun({
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
    engineRunId = db.createWorkflowEngineRun({ workflowRunId, objective: 'engine run' }).id
    engine = { kind: 'workflow-engine', workflowRunId }
  })

  afterEach(() => {
    db.close()
  })

  async function taskCreate(params: Record<string, unknown>, ctx: Partial<RpcContext>) {
    const method = eraseRpcMethods(ORCHESTRATION_METHODS).find(
      (m) => m.name === 'orchestration.taskCreate'
    )
    if (!method?.params) {
      throw new Error('orchestration.taskCreate is not registered')
    }
    return method.handler(method.params.parse(params), { runtime, ...ctx })
  }

  it('stamps workflow run, node and iteration on Tasks the engine creates', async () => {
    const upstream = db.createTask({ spec: 'upstream', runId: engineRunId })
    await taskCreate(
      {
        spec: 'read brief.md',
        deps: JSON.stringify([upstream.id]),
        workflowNodeId: 'review',
        workflowIteration: 2
      },
      { principal: engine }
    )
    const created = db.listTasks({ runId: engineRunId }).find((task) => task.spec !== 'upstream')
    expect(created).toMatchObject({
      run_id: engineRunId,
      deps: JSON.stringify([upstream.id]),
      workflow_run_id: engine.workflowRunId,
      workflow_node_id: 'review',
      workflow_iteration: 2
    })
  })

  it('defaults the iteration to 0 when the engine omits it', async () => {
    await taskCreate({ spec: 'work', workflowNodeId: 'implement' }, { principal: engine })
    expect(db.listTasks({ runId: engineRunId })[0]).toMatchObject({
      workflow_node_id: 'implement',
      workflow_iteration: 0
    })
  })

  it('refuses an iteration without a node id, even from the engine', async () => {
    await expect(
      taskCreate({ spec: 'work', workflowIteration: 1 }, { principal: engine })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(db.listTasks({ runId: engineRunId })).toEqual([])
  })

  it('creates a ready merge Task when one upstream failed and the other completed', async () => {
    const port = {
      call: (_method: string, params: Record<string, unknown>) =>
        taskCreate(params, { principal: engine })
    }
    const failed = db.createTask({ spec: 'a', runId: engineRunId })
    const completed = db.createTask({ spec: 'b', runId: engineRunId })
    db.updateTaskStatus(failed.id, 'failed')
    db.updateTaskStatus(completed.id, 'completed')
    const definition = workflow(
      [start, agent('a'), agent('b'), agent('c'), end],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'start', to: 'b' },
        { id: 'e3', from: 'a', to: 'c' },
        { id: 'e4', from: 'b', to: 'c' },
        { id: 'e5', from: 'c', to: 'end' }
      ]
    )
    const attempts = [
      attempt('start', 'completed'),
      attempt('a', 'failed', { taskId: failed.id }),
      attempt('b', 'completed', { taskId: completed.id })
    ]
    const taskId = await createNodeTask(port, {
      definition,
      attempts,
      nodeId: 'c',
      iteration: 0,
      spec: 'brief'
    })
    expect(db.getTask(taskId)).toMatchObject({
      status: 'ready',
      deps: JSON.stringify([completed.id])
    })
  })

  it('refuses a workflow node link from a terminal caller', async () => {
    const run = db.createRun({
      objective: 'terminal run',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    await expect(
      taskCreate({ spec: 'work', run: run.id, workflowNodeId: 'review' }, {})
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(db.listTasks({ runId: run.id })).toEqual([])
  })
})
