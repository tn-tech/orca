// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunQuestionView } from '../../../../../shared/workflows/workflow-run-types'
import QuestionCard from './QuestionCard'

const { workflowTrustDecideMock, workflowRunAnswerMock } = vi.hoisted(() => ({
  workflowTrustDecideMock: vi.fn(),
  workflowRunAnswerMock: vi.fn()
}))

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowTrustDecide: workflowTrustDecideMock,
  workflowRunAnswer: workflowRunAnswerMock
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  workflowTrustDecideMock.mockReset()
  workflowRunAnswerMock.mockReset()
})

const settings = { activeRuntimeEnvironmentId: null }

function trustQuestion(patch: Partial<RunQuestionView> = {}): RunQuestionView {
  return {
    id: 'question-1',
    runId: 'run-1',
    attemptId: 'attempt-1',
    kind: 'trust',
    prompt: 'Trust plugin source "speckit" on host ssh:devbox? Orca will install speckit-plan.',
    optionsJson: {
      choices: [
        { id: 'trusted', label: 'Trust this source' },
        { id: 'refused', label: 'Refuse' }
      ],
      trust: {
        source: 'speckit',
        host: 'ssh:devbox',
        skills: ['speckit-plan'],
        agents: ['claude']
      }
    },
    state: 'pending',
    ...patch
  }
}

function approvalQuestion(patch: Partial<RunQuestionView> = {}): RunQuestionView {
  return {
    id: 'question-2',
    runId: 'run-1',
    attemptId: 'attempt-1',
    kind: 'approval',
    prompt: 'Approve the plan?',
    optionsJson: {
      choices: [
        { id: 'Approve', label: 'Approve' },
        { id: 'Reject', label: 'Reject' }
      ]
    },
    state: 'pending',
    ...patch
  }
}

function agentQuestion(patch: Partial<RunQuestionView> = {}): RunQuestionView {
  return {
    id: 'question-3',
    runId: 'run-1',
    attemptId: 'attempt-1',
    kind: 'agent-question',
    prompt: 'Which migration strategy should I use?',
    optionsJson: { context: 'Two approaches are viable; both change the schema.' },
    state: 'pending',
    ...patch
  }
}

describe('QuestionCard', () => {
  it('shows a pending trust question with its host, and reviewing opens the trust dialog', async () => {
    workflowTrustDecideMock.mockResolvedValue({})
    render(<QuestionCard question={trustQuestion()} settings={settings} />)

    expect(screen.getByText('Trust required')).toBeInTheDocument()
    expect(screen.getByText('ssh:devbox')).toBeInTheDocument()
    expect(screen.queryByText('Trust this source?')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    expect(screen.getByText('Trust this source?')).toBeInTheDocument()
    expect(screen.getByText('speckit-plan')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Trust' }))

    await waitFor(() =>
      expect(workflowTrustDecideMock).toHaveBeenCalledWith(settings, {
        source: 'speckit',
        decision: 'trusted',
        host: 'ssh:devbox'
      })
    )
  })

  it('falls back to the plain-prompt summary for a trust question whose payload does not decode (review note)', () => {
    render(
      <QuestionCard
        question={trustQuestion({ optionsJson: {}, prompt: 'Trust an unnamed source?' })}
        settings={settings}
      />
    )

    expect(screen.getByText('Waiting on you')).toBeInTheDocument()
    expect(screen.getByText('Trust an unnamed source?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
  })

  describe('approval (FR-033)', () => {
    it('falls back to the plain-prompt summary for an approval question whose payload does not decode', () => {
      render(
        <QuestionCard question={approvalQuestion({ optionsJson: null })} settings={settings} />
      )

      expect(screen.getByText('Waiting on you')).toBeInTheDocument()
      expect(screen.getByText('Approve the plan?')).toBeInTheDocument()
    })

    it('shows one button per option and answers by optionId', async () => {
      workflowRunAnswerMock.mockResolvedValue({ state: 'running' })
      render(<QuestionCard question={approvalQuestion()} settings={settings} />)

      expect(screen.getByText('Approval needed')).toBeInTheDocument()
      expect(screen.getByText('Approve the plan?')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

      await waitFor(() =>
        expect(workflowRunAnswerMock).toHaveBeenCalledWith(settings, {
          runId: 'run-1',
          questionId: 'question-2',
          optionId: 'Approve'
        })
      )
    })

    it('flags an escalated approval that is still answerable', () => {
      render(
        <QuestionCard question={approvalQuestion({ state: 'escalated' })} settings={settings} />
      )

      expect(screen.getByText('Escalated')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    })

    it('shows the chosen option, the answerer and the time once answered', () => {
      render(
        <QuestionCard
          question={approvalQuestion({
            state: 'answered',
            answer: 'Reject',
            answeredBy: 'rami',
            answeredAt: '2026-01-01T12:00:00.000Z'
          })}
          settings={settings}
        />
      )

      expect(screen.getByText('Reject')).toBeInTheDocument()
      expect(screen.getByText(/Answered by rami/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    })

    it('shows a timeout note for an expired approval with no answer', () => {
      render(<QuestionCard question={approvalQuestion({ state: 'expired' })} settings={settings} />)

      expect(screen.getByText('Timed out with no answer.')).toBeInTheDocument()
    })

    it('shows the RPC error inline on a failed answer', async () => {
      workflowRunAnswerMock.mockRejectedValue(new Error('runtime_unavailable'))
      render(<QuestionCard question={approvalQuestion()} settings={settings} />)

      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

      await waitFor(() => expect(screen.getByText('runtime_unavailable')).toBeInTheDocument())
    })
  })

  describe('agent-question (FR-033a)', () => {
    it('shows the agent context and answers with free text', async () => {
      workflowRunAnswerMock.mockResolvedValue({ state: 'running' })
      render(<QuestionCard question={agentQuestion()} settings={settings} />)

      expect(screen.getByText('The agent has a question')).toBeInTheDocument()
      expect(
        screen.getByText('Two approaches are viable; both change the schema.')
      ).toBeInTheDocument()

      fireEvent.change(screen.getByPlaceholderText('Type your answer…'), {
        target: { value: 'Use the additive migration.' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Answer' }))

      await waitFor(() =>
        expect(workflowRunAnswerMock).toHaveBeenCalledWith(settings, {
          runId: 'run-1',
          questionId: 'question-3',
          answer: 'Use the additive migration.'
        })
      )
    })

    it('disables answering with a blank response', () => {
      render(<QuestionCard question={agentQuestion()} settings={settings} />)

      expect(screen.getByRole('button', { name: 'Answer' })).toBeDisabled()
      expect(workflowRunAnswerMock).not.toHaveBeenCalled()
    })

    it('shows the given answer, the answerer and the time once answered', () => {
      render(
        <QuestionCard
          question={agentQuestion({
            state: 'answered',
            answer: 'Use the additive migration.',
            answeredBy: 'rami',
            answeredAt: '2026-01-01T12:00:00.000Z'
          })}
          settings={settings}
        />
      )

      expect(screen.getByText('Use the additive migration.')).toBeInTheDocument()
      expect(screen.getByText(/Answered by rami/)).toBeInTheDocument()
      expect(screen.queryByPlaceholderText('Type your answer…')).not.toBeInTheDocument()
    })
  })
})
