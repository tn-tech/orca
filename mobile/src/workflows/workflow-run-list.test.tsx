import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileWorkflowQuestion, MobileWorkflowRunEvent } from './workflow-run-reply-schema'
import type { MobileWorkflowRunEntry, WorkflowAnswerOutcome } from './workflow-run-operations'
import { WorkflowRunList, type WorkflowRunListProps } from './WorkflowRunList'

vi.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  ActivityIndicator: 'ActivityIndicator'
}))

function question(overrides: Partial<MobileWorkflowQuestion>): MobileWorkflowQuestion {
  return {
    id: 'q-open',
    runId: 'run-1',
    attemptId: 'att-1',
    kind: 'approval',
    prompt: 'Approve the plan?',
    optionsJson: { approval: { options: ['Approve', 'Reject'] } },
    state: 'pending',
    answer: undefined,
    answeredBy: undefined,
    answeredAt: undefined,
    escalationAt: undefined,
    timeoutAt: undefined,
    ...overrides
  }
}

function expiryEvent(questionId: string, reason?: string): MobileWorkflowRunEvent {
  return {
    id: `e-${questionId}`,
    runId: 'run-1',
    attemptId: 'att-1',
    kind: 'agent_question_expired',
    payloadJson: reason ? { questionId, reason } : { questionId },
    createdAt: '2026-09-27T10:00:00.000Z'
  }
}

function waitingRun(
  questions: MobileWorkflowQuestion[],
  events: MobileWorkflowRunEvent[] = []
): MobileWorkflowRunEntry {
  return {
    run: {
      id: 'run-1',
      workflowName: 'feature-with-qa',
      objective: 'Add dark mode',
      state: 'waiting',
      createdAt: '2026-09-27T10:00:00.000Z',
      startedAt: undefined,
      finishedAt: undefined
    },
    questions,
    events
  }
}

const finishedRun: MobileWorkflowRunEntry = {
  run: {
    id: 'run-2',
    workflowName: 'bugfix',
    objective: 'Fix login',
    state: 'failed',
    createdAt: '2026-09-26T10:00:00.000Z',
    startedAt: undefined,
    finishedAt: undefined
  },
  questions: [],
  events: []
}

const answeredEarlier = question({
  id: 'q-done',
  attemptId: 'att-0',
  kind: 'agent-question',
  prompt: 'Earlier question',
  optionsJson: null,
  state: 'answered',
  answer: 'Yes',
  answeredBy: 'device-1'
})

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

function render(props: WorkflowRunListProps): ReactTestRenderer {
  act(() => {
    if (renderer) {
      renderer.update(createElement(WorkflowRunList, props))
    } else {
      renderer = create(createElement(WorkflowRunList, props))
    }
  })
  if (!renderer) {
    throw new Error('renderer did not mount')
  }
  return renderer
}

function text(root: ReactTestRenderer): string {
  return JSON.stringify(root.toJSON())
}

function pressApprove(root: ReactTestRenderer) {
  return root.root.find(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Approve'
  )
}

describe('WorkflowRunList', () => {
  it('lists open prompts first, then every run with its state', () => {
    const output = text(
      render({
        runs: [waitingRun([question({}), answeredEarlier]), finishedRun],
        onAnswer: vi.fn()
      })
    )
    expect(output).toContain('Needs you')
    expect(output.indexOf('Approve the plan?')).toBeLessThan(output.indexOf('Fix login'))
    expect(output).toContain('feature-with-qa')
    expect(output).toContain('Waiting')
    expect(output).toContain('bugfix')
    expect(output).toContain('Failed')
  })

  it('shows settled questions under their run, with who answered and what', () => {
    const output = text(render({ runs: [waitingRun([answeredEarlier])], onAnswer: vi.fn() }))
    expect(output).not.toContain('Needs you')
    expect(output).toContain('Earlier question')
    expect(output).toContain('Yes')
    expect(output).toContain('Answered by device-1')
  })

  it('tells a deadline timeout from a closure using the run events', () => {
    const timedOut = question({ id: 'q-timeout', prompt: 'Timed one', state: 'expired' })
    const closed = question({ id: 'q-closed', prompt: 'Closed one', state: 'expired' })
    const output = text(
      render({
        runs: [
          waitingRun(
            [timedOut, closed],
            [expiryEvent('q-timeout'), expiryEvent('q-closed', 'superseded')]
          )
        ],
        onAnswer: vi.fn()
      })
    )
    expect(output).toContain('Timed out with no answer.')
    expect(output).toContain('Closed with no answer.')
  })

  it('shows only the most recent settled questions of a run', () => {
    const settled = Array.from({ length: 5 }, (_, index) =>
      question({ id: `q-${index}`, prompt: `Settled ${index}`, state: 'answered', answer: 'ok' })
    )
    const output = text(render({ runs: [waitingRun(settled)], onAnswer: vi.fn() }))
    expect(output).not.toContain('Settled 0')
    expect(output).not.toContain('Settled 1')
    expect(output).toContain('Settled 2')
    expect(output).toContain('Settled 4')
  })

  it('answers a prompt against its own run and question', async () => {
    const onAnswer = vi.fn(async (): Promise<WorkflowAnswerOutcome> => ({ kind: 'answered' }))
    const root = render({ runs: [waitingRun([question({})])], onAnswer })
    await act(async () => {
      pressApprove(root).props.onPress()
    })
    expect(onAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'q-open', runId: 'run-1' }),
      { optionId: 'Approve' }
    )
  })

  it('ends showing who answered when another client answered first', async () => {
    const onAnswer = vi.fn(async (): Promise<WorkflowAnswerOutcome> => ({ kind: 'not-pending' }))
    const root = render({ runs: [waitingRun([question({})])], onAnswer })
    await act(async () => {
      pressApprove(root).props.onPress()
    })
    expect(text(root)).toContain('Already answered or closed.')

    // The refetch the hook runs after `not-pending` lands the other client's answer.
    const answeredElsewhere = question({
      state: 'answered',
      answer: 'Reject',
      answeredBy: 'device-2'
    })
    const output = text(render({ runs: [waitingRun([answeredElsewhere])], onAnswer }))
    expect(output).not.toContain('Needs you')
    expect(output).toContain('Reject')
    expect(output).toContain('Answered by device-2')
  })

  it('omits the prompt section when nothing is waiting, and says when there are no runs', () => {
    expect(text(render({ runs: [finishedRun], onAnswer: vi.fn() }))).not.toContain('Needs you')
    act(() => renderer?.unmount())
    renderer = undefined
    expect(text(render({ runs: [], onAnswer: vi.fn() }))).toContain('No workflow runs yet.')
  })
})
