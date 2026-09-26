import { describe, expect, it, vi } from 'vitest'
import { createNodeTask } from './workflow-frontier-node-task'
import { agent, attempt, end, linear, start, workflow } from './workflow-frontier-test-fixtures'

describe('createNodeTask', () => {
  it('creates the Task through the port with upstream task ids and the workflow link', async () => {
    const def = workflow(
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
      attempt('a', 'completed', { taskId: 'task_a' }),
      attempt('b', 'completed', { taskId: 'task_b' })
    ]
    const call = vi.fn(async () => ({ task: { id: 'task_c' } }))

    const taskId = await createNodeTask(
      { call },
      { definition: def, attempts, nodeId: 'c', iteration: 0, spec: 'read brief.md' }
    )

    expect(taskId).toBe('task_c')
    expect(call).toHaveBeenCalledWith('orchestration.taskCreate', {
      spec: 'read brief.md',
      taskTitle: 'Agent c',
      deps: JSON.stringify(['task_a', 'task_b']),
      workflowNodeId: 'c',
      workflowIteration: 0
    })
  })

  it('records only upstreams whose edge fired, so a merge after a failed branch stays dispatchable', async () => {
    const def = workflow(
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
      attempt('a', 'failed', { taskId: 'task_a' }),
      attempt('b', 'completed', { taskId: 'task_b' })
    ]
    const call = vi.fn(async () => ({ task: { id: 'task_c' } }))
    await createNodeTask(
      { call },
      { definition: def, attempts, nodeId: 'c', iteration: 0, spec: 'brief' }
    )
    expect(call).toHaveBeenCalledWith(
      'orchestration.taskCreate',
      expect.objectContaining({ deps: JSON.stringify(['task_b']) })
    )
  })

  it('omits start (task-less) upstreams from deps', async () => {
    const call = vi.fn(async () => ({ task: { id: 'task_a' } }))
    await createNodeTask(
      { call },
      {
        definition: linear,
        attempts: [attempt('start', 'completed')],
        nodeId: 'a',
        iteration: 0,
        spec: 'brief'
      }
    )
    expect(call).toHaveBeenCalledWith(
      'orchestration.taskCreate',
      expect.objectContaining({ deps: '[]' })
    )
  })

  it('refuses a node that is not in the definition', async () => {
    const call = vi.fn()
    await expect(
      createNodeTask(
        { call },
        { definition: linear, attempts: [], nodeId: 'ghost', iteration: 0, spec: 's' }
      )
    ).rejects.toThrow(/ghost/)
    expect(call).not.toHaveBeenCalled()
  })

  it('throws when the port returns no task id', async () => {
    const call = vi.fn(async () => ({ task: {} }))
    await expect(
      createNodeTask(
        { call },
        {
          definition: linear,
          attempts: [attempt('start', 'completed')],
          nodeId: 'a',
          iteration: 0,
          spec: 's'
        }
      )
    ).rejects.toThrow(/task id/)
  })
})
