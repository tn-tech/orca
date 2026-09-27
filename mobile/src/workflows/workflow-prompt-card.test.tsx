import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileWorkflowQuestion } from './workflow-run-reply-schema'
import type { WorkflowAnswerOutcome, WorkflowQuestionAnswer } from './workflow-run-operations'
import { WorkflowPromptCard } from './WorkflowPromptCard'

vi.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value },
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  ActivityIndicator: 'ActivityIndicator'
}))

function question(overrides: Partial<MobileWorkflowQuestion>): MobileWorkflowQuestion {
  return {
    id: 'q-1',
    runId: 'run-1',
    attemptId: 'att-1',
    kind: 'approval',
    prompt: 'Approve the plan?',
    optionsJson: null,
    state: 'pending',
    answer: undefined,
    answeredBy: undefined,
    answeredAt: undefined,
    escalationAt: undefined,
    timeoutAt: undefined,
    ...overrides
  }
}

const approval = question({
  optionsJson: {
    choices: [
      { id: 'Approve', label: 'Approve' },
      { id: 'Reject', label: 'Reject' }
    ],
    approval: { options: ['Approve', 'Reject'], defaultOption: 'Reject' }
  }
})

const agentQuestion = question({
  id: 'q-2',
  kind: 'agent-question',
  prompt: 'Which database should I use?',
  optionsJson: { context: 'The spec mentions both SQLite and Postgres.' }
})

let renderer: ReactTestRenderer | undefined

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

function render(
  subject: MobileWorkflowQuestion,
  onAnswer: (answer: WorkflowQuestionAnswer) => Promise<WorkflowAnswerOutcome>
): ReactTestRenderer {
  act(() => {
    renderer = create(createElement(WorkflowPromptCard, { question: subject, onAnswer }))
  })
  if (!renderer) {
    throw new Error('renderer did not mount')
  }
  return renderer
}

function text(root: ReactTestRenderer): string {
  return JSON.stringify(root.toJSON())
}

function buttons(root: ReactTestRenderer): ReactTestInstance[] {
  return root.root.findAll((node) => String(node.type) === 'Pressable')
}

function button(root: ReactTestRenderer, label: string): ReactTestInstance {
  const match = buttons(root).find((node) => node.props.accessibilityLabel === label)
  if (!match) {
    throw new Error(`no button labelled ${label}`)
  }
  return match
}

describe('WorkflowPromptCard', () => {
  it('renders an approval with one answer action per option, answered by optionId', async () => {
    const onAnswer = vi.fn(async () => ({ kind: 'answered' as const }))
    const root = render(approval, onAnswer)

    expect(text(root)).toContain('Approval needed')
    expect(text(root)).toContain('Approve the plan?')
    expect(text(root)).toContain('Default on timeout: Reject')
    expect(buttons(root).map((node) => node.props.accessibilityLabel)).toEqual([
      'Approve',
      'Reject'
    ])

    await act(async () => {
      button(root, 'Approve').props.onPress()
    })
    expect(onAnswer).toHaveBeenCalledWith({ optionId: 'Approve' })
  })

  it('renders an agent question with its context and answers with the trimmed text', async () => {
    const onAnswer = vi.fn(async () => ({ kind: 'answered' as const }))
    const root = render(agentQuestion, onAnswer)

    expect(text(root)).toContain('The agent has a question')
    expect(text(root)).toContain('Which database should I use?')
    expect(text(root)).toContain('The spec mentions both SQLite and Postgres.')
    expect(button(root, 'Answer').props.disabled).toBe(true)

    act(() => {
      root.root
        .find((node) => String(node.type) === 'TextInput')
        .props.onChangeText('  Use SQLite  ')
    })
    expect(button(root, 'Answer').props.disabled).toBe(false)
    await act(async () => {
      button(root, 'Answer').props.onPress()
    })
    expect(onAnswer).toHaveBeenCalledWith({ answer: 'Use SQLite' })
  })

  it('marks an escalated question and keeps it answerable', () => {
    const root = render({ ...approval, state: 'escalated' }, vi.fn())
    expect(text(root)).toContain('Escalated')
    expect(button(root, 'Approve').props.disabled).toBe(false)
  })

  it('disables answering once the host says it cannot answer from mobile', async () => {
    const onAnswer = vi.fn(async () => ({ kind: 'unsupported' as const }))
    const root = render(approval, onAnswer)
    await act(async () => {
      button(root, 'Reject').props.onPress()
    })
    expect(text(root)).toContain("Answering isn't available on this host yet.")
    expect(buttons(root).every((node) => node.props.disabled === true)).toBe(true)
  })

  it('shows the host error and lets the person retry', async () => {
    const onAnswer = vi.fn(async () => ({ kind: 'error' as const, message: 'boom' }))
    const root = render(approval, onAnswer)
    await act(async () => {
      button(root, 'Approve').props.onPress()
    })
    expect(text(root)).toContain('boom')
    expect(button(root, 'Approve').props.disabled).toBe(false)
  })

  it('says so when someone else answered first', async () => {
    const onAnswer = vi.fn(async () => ({ kind: 'not-pending' as const }))
    const root = render(approval, onAnswer)
    await act(async () => {
      button(root, 'Approve').props.onPress()
    })
    expect(text(root)).toContain('Already answered or closed.')
  })

  it('shows a trust question read-only, to be decided on desktop', () => {
    const root = render(
      question({
        kind: 'trust',
        prompt: 'Trust skills from acme/roles?',
        optionsJson: { trust: { source: 'acme/roles', host: 'local', skills: [], agents: [] } }
      }),
      vi.fn()
    )
    expect(text(root)).toContain('Trust required')
    expect(text(root)).toContain('acme/roles')
    expect(text(root)).toContain('Review this on the desktop app.')
    expect(buttons(root)).toHaveLength(0)
  })

  it('shows a settled question with its answer and no actions', () => {
    const root = render(
      { ...approval, state: 'answered', answer: 'Approve', answeredBy: 'device-1' },
      vi.fn()
    )
    expect(text(root)).toContain('Approve')
    expect(text(root)).toContain('Answered by device-1')
    expect(buttons(root)).toHaveLength(0)
  })

  it('names a default the engine applied instead of a person', () => {
    const root = render(
      {
        ...approval,
        state: 'answered',
        answer: 'Reject',
        answeredBy: 'workflow-engine:default-option'
      },
      vi.fn()
    )
    expect(text(root)).toContain('Default applied after timeout')
  })

  it('shows an unanswered expired question as closed', () => {
    const root = render({ ...agentQuestion, state: 'expired' }, vi.fn())
    expect(text(root)).toContain('Closed with no answer.')
    expect(buttons(root)).toHaveLength(0)
  })

  it('shows a question kind this app does not know as its prompt only', () => {
    const root = render(question({ kind: undefined, prompt: 'Pick a gate' }), vi.fn())
    expect(text(root)).toContain('Pick a gate')
    expect(buttons(root)).toHaveLength(0)
  })
})
