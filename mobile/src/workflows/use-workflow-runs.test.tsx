import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import { useWorkflowRuns, type WorkflowRunsState } from './use-workflow-runs'

type Handler = (method: string, params: unknown) => Promise<RpcResponse> | RpcResponse

const host = vi.hoisted(() => {
  const sent: { method: string; params: unknown }[] = []
  const streams: ((payload: unknown) => void)[] = []
  const box: { state: string; handler: (method: string, params: unknown) => unknown } = {
    state: 'connected',
    handler: () => undefined
  }
  const client = {
    sendRequest: async (method: string, params?: unknown) => {
      sent.push({ method, params })
      return box.handler(method, params)
    },
    subscribe: (_method: string, _params: unknown, listener: (payload: unknown) => void) => {
      streams.push(listener)
      return () => {
        streams.splice(streams.indexOf(listener), 1)
      }
    }
  }
  return { sent, streams, box, client }
})

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) }
}))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: host.client, clientId: 'c-1', state: host.box.state })
}))

function ok(result: unknown): RpcResponse {
  return { id: 'r', ok: true, result }
}

function refused(code: string, message = code): RpcResponse {
  return { id: 'r', ok: false, error: { code, message } }
}

function run(id: string, state = 'waiting', objective = `objective ${id}`) {
  return { id, workflowName: 'feature', objective, state, createdAt: '2026-09-27T10:00:00.000Z' }
}

function pending(runId: string) {
  return {
    id: `q-${runId}`,
    runId,
    attemptId: 'att-1',
    kind: 'approval',
    prompt: 'Approve?',
    optionsJson: { approval: { options: ['Approve'] } },
    state: 'pending'
  }
}

function serve(runs: ReturnType<typeof run>[]): Handler {
  return (method, params) => {
    if (method === 'workflow.run.list') {
      return ok({ runs })
    }
    const runId = params && typeof params === 'object' && 'runId' in params ? params.runId : ''
    const found = runs.find((candidate) => candidate.id === runId)
    if (method === 'workflow.run.answer') {
      return ok({ state: 'running' })
    }
    return found
      ? ok({ ...found, questions: [pending(found.id)], events: [] })
      : refused('workflow_not_found')
  }
}

let latest: WorkflowRunsState | undefined
let renderer: ReactTestRenderer | undefined

function Probe() {
  latest = useWorkflowRuns('host-a')
  return null
}

function current(): WorkflowRunsState {
  if (!latest) {
    throw new Error('hook did not render')
  }
  return latest
}

async function mount() {
  await act(async () => {
    renderer = create(createElement(Probe))
  })
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve))
  })
}

beforeEach(() => {
  host.sent.length = 0
  host.streams.length = 0
  host.box.state = 'connected'
  latest = undefined
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

describe('useWorkflowRuns', () => {
  it('loads the runs and their open questions once connected', async () => {
    host.box.handler = serve([run('run-1')])
    await mount()
    await settle()
    expect(current().runs).toMatchObject([{ run: { id: 'run-1' }, questions: [{ id: 'q-run-1' }] }])
    expect(current().unsupported).toBe(false)
    expect(current().refreshing).toBe(false)
  })

  it('reports a host without workflows as unsupported', async () => {
    host.box.handler = () => refused('method_not_found')
    await mount()
    await settle()
    expect(current().unsupported).toBe(true)
    expect(current().runs).toEqual([])
  })

  it('surfaces a load error, and clears it on the next good load', async () => {
    host.box.handler = () => refused('internal_error', 'db locked')
    await mount()
    await settle()
    expect(current().error).toBe('db locked')
    expect(current().runs).toBeNull()

    host.box.handler = serve([run('run-1')])
    await act(async () => current().refresh())
    await settle()
    expect(current().error).toBeNull()
    expect(current().runs).toHaveLength(1)
  })

  it('re-reads only the run a workflowRunChanged event names', async () => {
    const runs = [run('run-1'), run('run-2')]
    host.box.handler = serve(runs)
    await mount()
    await settle()
    host.sent.length = 0

    runs[0] = run('run-1', 'running', 'updated objective')
    await act(async () => {
      host.streams.forEach((listener) =>
        listener({ type: 'workflowRunChanged', runId: 'run-1', reason: 'state' })
      )
    })
    await settle()
    expect(host.sent).toEqual([{ method: 'workflow.run.show', params: { runId: 'run-1' } }])
    expect(current().runs?.map((entry) => entry.run.objective)).toEqual([
      'updated objective',
      'objective run-2'
    ])
  })

  it('reloads the list for a run it has not seen yet', async () => {
    const runs = [run('run-1')]
    host.box.handler = serve(runs)
    await mount()
    await settle()
    host.sent.length = 0
    runs.unshift(run('run-new'))
    await act(async () => {
      host.streams.forEach((listener) =>
        listener({ type: 'workflowRunChanged', runId: 'run-new', reason: 'state' })
      )
    })
    await settle()
    expect(host.sent[0]?.method).toBe('workflow.run.list')
    expect(current().runs?.map((entry) => entry.run.id)).toEqual(['run-new', 'run-1'])
  })

  it('drops a late load after disconnecting, and does not leave the spinner on', async () => {
    let release: (reply: RpcResponse) => void = () => {}
    host.box.handler = () =>
      new Promise<RpcResponse>((resolve) => {
        release = resolve
      })
    await mount()
    expect(current().refreshing).toBe(true)

    host.box.state = 'disconnected'
    await act(async () => {
      renderer?.update(createElement(Probe))
    })
    expect(current().refreshing).toBe(false)
    release(ok({ runs: [run('run-1', 'completed')] }))
    await settle()
    expect(current().runs).toBeNull()
    expect(current().refreshing).toBe(false)
  })

  it('re-reads the answered run after an answer lands', async () => {
    host.box.handler = serve([run('run-1')])
    await mount()
    await settle()
    host.sent.length = 0
    const question = current().runs?.[0]?.questions[0]
    if (!question) {
      throw new Error('no question loaded')
    }
    await act(async () => {
      await expect(current().answer(question, { optionId: 'Approve' })).resolves.toEqual({
        kind: 'answered'
      })
    })
    await settle()
    expect(host.sent.map((entry) => entry.method)).toEqual([
      'workflow.run.answer',
      'workflow.run.show'
    ])
  })
})
