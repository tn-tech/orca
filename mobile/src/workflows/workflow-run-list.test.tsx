import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileWorkflowRunEntry } from './workflow-run-operations'
import { WorkflowRunList } from './WorkflowRunList'

vi.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  ActivityIndicator: 'ActivityIndicator'
}))

const waitingRun: MobileWorkflowRunEntry = {
  run: {
    id: 'run-1',
    workflowName: 'feature-with-qa',
    objective: 'Add dark mode',
    state: 'waiting',
    createdAt: '2026-09-27T10:00:00.000Z',
    startedAt: undefined,
    finishedAt: undefined
  },
  questions: [
    {
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
      timeoutAt: undefined
    },
    {
      id: 'q-done',
      runId: 'run-1',
      attemptId: 'att-0',
      kind: 'agent-question',
      prompt: 'Earlier question',
      optionsJson: null,
      state: 'answered',
      answer: 'Yes',
      answeredBy: 'device-1',
      answeredAt: undefined,
      escalationAt: undefined,
      timeoutAt: undefined
    }
  ]
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
  questions: []
}

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

function render(runs: MobileWorkflowRunEntry[], onAnswer = vi.fn()): ReactTestRenderer {
  act(() => {
    renderer = create(createElement(WorkflowRunList, { runs, onAnswer }))
  })
  if (!renderer) {
    throw new Error('renderer did not mount')
  }
  return renderer
}

describe('WorkflowRunList', () => {
  it('lists open prompts first, then every run with its state', () => {
    const root = render([waitingRun, finishedRun])
    const output = JSON.stringify(root.toJSON())

    expect(output).toContain('Needs you')
    expect(output).toContain('Approve the plan?')
    expect(output).not.toContain('Earlier question')
    expect(output.indexOf('Approve the plan?')).toBeLessThan(output.indexOf('Fix login'))
    expect(output).toContain('feature-with-qa')
    expect(output).toContain('Waiting')
    expect(output).toContain('bugfix')
    expect(output).toContain('Failed')
  })

  it('answers a prompt against its own run and question', async () => {
    const onAnswer = vi.fn(async () => ({ kind: 'answered' as const }))
    const root = render([waitingRun], onAnswer)
    const approve = root.root.find(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Approve'
    )
    await act(async () => {
      approve.props.onPress()
    })
    expect(onAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'q-open', runId: 'run-1' }),
      { optionId: 'Approve' }
    )
  })

  it('omits the prompt section when nothing is waiting, and says when there are no runs', () => {
    expect(JSON.stringify(render([finishedRun]).toJSON())).not.toContain('Needs you')
    act(() => renderer?.unmount())
    expect(JSON.stringify(render([]).toJSON())).toContain('No workflow runs yet.')
  })
})
