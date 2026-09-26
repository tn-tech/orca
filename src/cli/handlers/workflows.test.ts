import { afterEach, describe, expect, it, vi } from 'vitest'

const successMeta = { runtimeId: 'runtime-1' }

function success<TResult>(result: TResult): {
  id: string
  ok: true
  result: TResult
  _meta: typeof successMeta
} {
  return { id: 'request-1', ok: true, result, _meta: successMeta }
}

// Why: isolate the handler's flag-to-param mapping; printResult only writes output, and the
// formatXxx bindings are asserted by reference below rather than by their rendered text.
vi.mock('../format', () => ({
  printResult: vi.fn(),
  formatWorkflowList: vi.fn(),
  formatWorkflowShow: vi.fn(),
  formatWorkflowValidate: vi.fn(),
  formatWorkflowRunStart: vi.fn(),
  formatWorkflowRunList: vi.fn(),
  formatWorkflowRunStatus: vi.fn(),
  // Why: unlike the others, --wait calls this one directly (not just via printResult), so the
  // stub must be callable and return a renderable string.
  formatWorkflowRunEventLine: vi.fn(() => 'event-line')
}))
vi.mock('../stdout-line', () => ({ writeStdoutLine: vi.fn() }))

import { WORKFLOW_HANDLERS } from './workflows'
import {
  formatWorkflowList,
  formatWorkflowRunList,
  formatWorkflowRunStart,
  formatWorkflowRunStatus,
  formatWorkflowShow,
  formatWorkflowValidate,
  printResult
} from '../format'
import { writeStdoutLine } from '../stdout-line'
import { RuntimeClientError } from '../runtime-client'

function context(
  call: ReturnType<typeof vi.fn>,
  flags = new Map<string, string | boolean>(),
  options: { isRemote?: boolean; json?: boolean; cwd?: string } = {}
) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these handlers read only `call` and `isRemote`; RuntimeClient is a class, so a structural double cannot satisfy it without the cast.
  return {
    client: { call, isRemote: options.isRemote ?? false },
    cwd: options.cwd ?? '/repo',
    flags,
    json: options.json ?? false
  } as never
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(printResult).mockClear()
  vi.mocked(writeStdoutLine).mockClear()
  vi.useRealTimers()
  process.exitCode = undefined
})

describe('workflows CLI handlers', () => {
  it('lists workflows for an explicit --repo', async () => {
    const call = vi.fn().mockResolvedValue(success({ workflows: [] }))

    await WORKFLOW_HANDLERS['workflows list']!(context(call, new Map([['repo', 'my-repo']])))

    expect(call).toHaveBeenCalledWith('workflow.list', { repo: 'my-repo' })
    expect(printResult).toHaveBeenCalledWith(
      await call.mock.results[0]!.value,
      false,
      formatWorkflowList
    )
  })

  it('defaults workflows list to the enclosing worktree when --repo is omitted', async () => {
    const call = vi.fn().mockResolvedValue(success({ workflows: [] }))

    await WORKFLOW_HANDLERS['workflows list']!(context(call, new Map(), { cwd: '/repo/nested' }))

    expect(call).toHaveBeenCalledWith('workflow.list', { repo: 'path:/repo/nested' })
  })

  it('reads one workflow definition by name', async () => {
    const call = vi.fn().mockResolvedValue(success({ definition: {}, raw: '', revision: 'r1' }))

    await WORKFLOW_HANDLERS['workflows show']!(context(call, new Map([['name', 'release']])))

    expect(call).toHaveBeenCalledWith('workflow.read', {
      repo: 'path:/repo',
      name: 'release'
    })
    expect(printResult).toHaveBeenCalledWith(
      await call.mock.results[0]!.value,
      false,
      formatWorkflowShow
    )
  })

  it('validates a workflow by reading it first, then calling workflow.validate', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(success({ definition: { name: 'release' } }))
      .mockResolvedValueOnce(success({ problems: [] }))

    await WORKFLOW_HANDLERS['workflows validate']!(context(call, new Map([['name', 'release']])))

    expect(call).toHaveBeenNthCalledWith(1, 'workflow.read', {
      repo: 'path:/repo',
      name: 'release'
    })
    expect(call).toHaveBeenNthCalledWith(2, 'workflow.validate', {
      repo: 'path:/repo',
      definition: { name: 'release' }
    })
    expect(printResult).toHaveBeenCalledWith(
      await call.mock.results[1]!.value,
      false,
      formatWorkflowValidate
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('exits 1 when validation reports an error-severity problem', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(success({ definition: {} }))
      .mockResolvedValueOnce(
        success({ problems: [{ code: 'bad', message: 'bad', severity: 'error' }] })
      )

    await WORKFLOW_HANDLERS['workflows validate']!(context(call, new Map([['name', 'release']])))

    expect(process.exitCode).toBe(1)
  })

  it('prints the read problems and exits 1 when the file has no definition, without calling workflow.validate', async () => {
    const readProblems = [
      { code: 'workflow_file_version_unsupported', message: 'bad version', severity: 'error' }
    ]
    const call = vi
      .fn()
      .mockResolvedValueOnce(success({ definition: undefined, problems: readProblems }))

    await WORKFLOW_HANDLERS['workflows validate']!(context(call, new Map([['name', 'release']])))

    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('workflow.read', { repo: 'path:/repo', name: 'release' })
    expect(call).not.toHaveBeenCalledWith('workflow.validate', expect.anything())
    expect(printResult).toHaveBeenCalledWith(
      expect.objectContaining({ result: { problems: readProblems } }),
      false,
      formatWorkflowValidate
    )
    expect(process.exitCode).toBe(1)
  })

  it('starts a workflow run with an optional concurrency override', async () => {
    const call = vi.fn().mockResolvedValue(success({ runId: 'run-1' }))

    await WORKFLOW_HANDLERS['workflows run']!(
      context(
        call,
        new Map([
          ['name', 'release'],
          ['objective', 'Ship it'],
          ['concurrency', '3']
        ])
      )
    )

    expect(call).toHaveBeenCalledWith('workflow.run.start', {
      repo: 'path:/repo',
      name: 'release',
      objective: 'Ship it',
      overrides: { concurrencyLimit: 3 }
    })
    expect(printResult).toHaveBeenCalledWith(
      await call.mock.results[0]!.value,
      false,
      formatWorkflowRunStart
    )
  })

  it('lists workflow runs filtered by name and state', async () => {
    const call = vi.fn().mockResolvedValue(success({ runs: [] }))

    await WORKFLOW_HANDLERS['workflows runs']!(
      context(
        call,
        new Map([
          ['name', 'release'],
          ['state', 'running']
        ])
      )
    )

    expect(call).toHaveBeenCalledWith('workflow.run.list', { name: 'release', state: 'running' })
    expect(printResult).toHaveBeenCalledWith(
      await call.mock.results[0]!.value,
      false,
      formatWorkflowRunList
    )
  })

  it('shows run status once when --wait is absent', async () => {
    const call = vi.fn().mockResolvedValue(success({ state: 'running' }))

    await WORKFLOW_HANDLERS['workflows status']!(context(call, new Map([['run-id', 'run-1']])))

    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('workflow.run.show', { runId: 'run-1' })
    expect(printResult).toHaveBeenCalledWith(
      await call.mock.results[0]!.value,
      false,
      formatWorkflowRunStatus
    )
  })

  it('polls run.show/run.events until terminal when --wait is set, streaming each event', async () => {
    vi.useFakeTimers()
    const runningEvent = { id: '1', runId: 'run-1', kind: 'attempt_running', payloadJson: {} }
    const call = vi
      .fn()
      .mockResolvedValueOnce(success({ state: 'running' }))
      .mockResolvedValueOnce(success({ events: [runningEvent], nextSeq: 5 }))
      .mockResolvedValueOnce(success({ state: 'completed' }))

    const pending = WORKFLOW_HANDLERS['workflows status']!(
      context(
        call,
        new Map<string, string | boolean>([
          ['run-id', 'run-1'],
          ['wait', true]
        ])
      )
    )
    await vi.advanceTimersByTimeAsync(2000)
    await pending

    expect(call).toHaveBeenNthCalledWith(1, 'workflow.run.show', { runId: 'run-1' })
    expect(call).toHaveBeenNthCalledWith(2, 'workflow.run.events', {
      runId: 'run-1',
      afterSeq: undefined
    })
    expect(call).toHaveBeenNthCalledWith(3, 'workflow.run.show', { runId: 'run-1' })
    expect(writeStdoutLine).toHaveBeenCalledWith('event-line')
    expect(printResult).toHaveBeenCalledWith(
      await call.mock.results[2]!.value,
      false,
      formatWorkflowRunStatus
    )
  })

  it('suppresses --wait progress lines in --json mode', async () => {
    vi.useFakeTimers()
    const call = vi
      .fn()
      .mockResolvedValueOnce(success({ state: 'running' }))
      .mockResolvedValueOnce(
        success({ events: [{ id: '1', runId: 'run-1', kind: 'x', payloadJson: {} }], nextSeq: 5 })
      )
      .mockResolvedValueOnce(success({ state: 'completed' }))

    const pending = WORKFLOW_HANDLERS['workflows status']!(
      context(
        call,
        new Map<string, string | boolean>([
          ['run-id', 'run-1'],
          ['wait', true]
        ]),
        { json: true }
      )
    )
    await vi.advanceTimersByTimeAsync(2000)
    await pending

    expect(writeStdoutLine).not.toHaveBeenCalled()
  })

  it('answers a question with --option', async () => {
    const call = vi.fn().mockResolvedValue(success({ state: 'running' }))

    await WORKFLOW_HANDLERS['workflows answer']!(
      context(
        call,
        new Map([
          ['run-id', 'run-1'],
          ['question-id', 'q-1'],
          ['option', 'approve']
        ])
      )
    )

    expect(call).toHaveBeenCalledWith('workflow.run.answer', {
      runId: 'run-1',
      questionId: 'q-1',
      optionId: 'approve'
    })
  })

  it('answers a question with --text', async () => {
    const call = vi.fn().mockResolvedValue(success({ state: 'running' }))

    await WORKFLOW_HANDLERS['workflows answer']!(
      context(
        call,
        new Map([
          ['run-id', 'run-1'],
          ['question-id', 'q-1'],
          ['text', 'Looks good']
        ])
      )
    )

    expect(call).toHaveBeenCalledWith('workflow.run.answer', {
      runId: 'run-1',
      questionId: 'q-1',
      answer: 'Looks good'
    })
  })

  it('rejects answering with both --option and --text', async () => {
    const call = vi.fn()

    await expect(
      WORKFLOW_HANDLERS['workflows answer']!(
        context(
          call,
          new Map([
            ['run-id', 'run-1'],
            ['question-id', 'q-1'],
            ['option', 'approve'],
            ['text', 'Looks good']
          ])
        )
      )
    ).rejects.toThrow(RuntimeClientError)
    expect(call).not.toHaveBeenCalled()
  })

  it('rejects answering with neither --option nor --text', async () => {
    const call = vi.fn()

    await expect(
      WORKFLOW_HANDLERS['workflows answer']!(
        context(
          call,
          new Map([
            ['run-id', 'run-1'],
            ['question-id', 'q-1']
          ])
        )
      )
    ).rejects.toThrow(RuntimeClientError)
  })

  it('sends a queued message by default', async () => {
    const call = vi.fn().mockResolvedValue(success({ messageId: 'm-1' }))

    await WORKFLOW_HANDLERS['workflows send']!(
      context(
        call,
        new Map([
          ['run-id', 'run-1'],
          ['attempt-id', 'attempt-1'],
          ['text', 'hi']
        ])
      )
    )

    expect(call).toHaveBeenCalledWith('workflow.run.sendMessage', {
      runId: 'run-1',
      attemptId: 'attempt-1',
      text: 'hi',
      mode: 'queued'
    })
  })

  it('sends an interrupting message with --interrupt', async () => {
    const call = vi.fn().mockResolvedValue(success({ messageId: 'm-1' }))

    await WORKFLOW_HANDLERS['workflows send']!(
      context(
        call,
        new Map<string, string | boolean>([
          ['run-id', 'run-1'],
          ['attempt-id', 'attempt-1'],
          ['text', 'stop'],
          ['interrupt', true]
        ])
      )
    )

    expect(call).toHaveBeenCalledWith('workflow.run.sendMessage', {
      runId: 'run-1',
      attemptId: 'attempt-1',
      text: 'stop',
      mode: 'interrupt'
    })
  })

  it.each([
    ['workflows pause', 'workflow.run.pause'],
    ['workflows resume', 'workflow.run.resume'],
    ['workflows cancel', 'workflow.run.cancel']
  ])('%s calls %s', async (command, method) => {
    const call = vi.fn().mockResolvedValue(success({ state: 'running' }))

    await WORKFLOW_HANDLERS[command]!(context(call, new Map([['run-id', 'run-1']])))

    expect(call).toHaveBeenCalledWith(method, { runId: 'run-1' })
  })

  it('reruns a workflow from a node', async () => {
    const call = vi.fn().mockResolvedValue(success({ runId: 'run-2' }))

    await WORKFLOW_HANDLERS['workflows rerun']!(
      context(
        call,
        new Map([
          ['run-id', 'run-1'],
          ['from', 'review-node']
        ])
      )
    )

    expect(call).toHaveBeenCalledWith('workflow.run.rerun', {
      runId: 'run-1',
      fromNodeId: 'review-node'
    })
  })

  it('decides trust for a source', async () => {
    const call = vi.fn().mockResolvedValue(success({}))

    await WORKFLOW_HANDLERS['workflows trust']!(
      context(
        call,
        new Map([
          ['source', 'github.com/org/roles'],
          ['decision', 'trusted']
        ])
      )
    )

    expect(call).toHaveBeenCalledWith('workflow.trust.decide', {
      source: 'github.com/org/roles',
      decision: 'trusted'
    })
  })
})
