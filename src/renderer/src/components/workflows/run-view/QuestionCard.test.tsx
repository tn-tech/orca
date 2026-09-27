// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunQuestionView } from '../../../../../shared/workflows/workflow-run-types'
import {
  APPROVAL_DEFAULT_ANSWERER,
  approvalQuestionOptions
} from '../../../../../shared/workflows/workflow-approval-question-subject'
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

function methodNotFoundError(): Error {
  return new Error('method_not_found')
}

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
    optionsJson: approvalQuestionOptions({ options: ['Approve', 'Reject'] }),
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
  describe('trust (FR-018a)', () => {
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

    it('shows a settled summary instead of "Trust required" once a trust question is answered (review round 1, finding 1)', () => {
      render(
        <QuestionCard
          question={trustQuestion({
            state: 'answered',
            answer: 'trusted',
            answeredBy: 'rami',
            answeredAt: '2026-01-01T12:00:00.000Z'
          })}
          settings={settings}
        />
      )

      expect(screen.queryByText('Trust required')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
      expect(screen.getByText('Trusted')).toBeInTheDocument()
      expect(screen.getByText(/Answered by rami/)).toBeInTheDocument()
    })

    it('shows a refused settled summary', () => {
      render(
        <QuestionCard
          question={trustQuestion({ state: 'answered', answer: 'refused' })}
          settings={settings}
        />
      )

      expect(screen.getByText('Refused')).toBeInTheDocument()
    })
  })

  describe('approval (FR-033)', () => {
    it('falls back to the plain-prompt summary for a pending approval question whose payload does not decode', () => {
      render(
        <QuestionCard question={approvalQuestion({ optionsJson: null })} settings={settings} />
      )

      expect(screen.getByText('Waiting on you')).toBeInTheDocument()
      expect(screen.getByText('Approve the plan?')).toBeInTheDocument()
    })

    it('shows a settled summary — not "Waiting on you" — for an answered approval whose payload does not decode (review round 1, finding 1)', () => {
      render(
        <QuestionCard
          question={approvalQuestion({
            optionsJson: null,
            state: 'answered',
            answer: 'Approve',
            answeredBy: 'rami',
            answeredAt: '2026-01-01T12:00:00.000Z'
          })}
          settings={settings}
        />
      )

      expect(screen.queryByText('Waiting on you')).not.toBeInTheDocument()
      expect(screen.getByText('Approve')).toBeInTheDocument()
      expect(screen.getByText(/Answered by rami/)).toBeInTheDocument()
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

    it('shows the configured default option', () => {
      render(
        <QuestionCard
          question={approvalQuestion({
            optionsJson: approvalQuestionOptions({
              options: ['Approve', 'Reject'],
              defaultOption: 'Approve'
            })
          })}
          settings={settings}
        />
      )

      expect(screen.getByText('Default on timeout: Approve')).toBeInTheDocument()
    })

    it('flags an escalated approval that is still answerable, without the destructive treatment (review round 1, minor)', () => {
      render(
        <QuestionCard question={approvalQuestion({ state: 'escalated' })} settings={settings} />
      )

      const badge = screen.getByText('Escalated')
      expect(badge).toBeInTheDocument()
      expect(badge).toHaveAttribute('data-variant', 'review')
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

    it('shows "Default applied" instead of an answerer when the engine applied the default on timeout (review round 1, finding 3)', () => {
      render(
        <QuestionCard
          question={approvalQuestion({
            state: 'answered',
            answer: 'Approve',
            answeredBy: APPROVAL_DEFAULT_ANSWERER,
            answeredAt: '2026-01-01T12:00:00.000Z'
          })}
          settings={settings}
        />
      )

      expect(screen.getByText(/Default applied after timeout at/)).toBeInTheDocument()
      expect(screen.queryByText(/Answered by/)).not.toBeInTheDocument()
    })

    it('shows a timeout note for an expired approval with no answer', () => {
      render(<QuestionCard question={approvalQuestion({ state: 'expired' })} settings={settings} />)

      expect(screen.getByText('Timed out with no answer.')).toBeInTheDocument()
    })

    it('shows a closed note instead of a timeout note when the run ended first (review round 1, minor)', () => {
      render(
        <QuestionCard
          question={approvalQuestion({ state: 'expired' })}
          settings={settings}
          expiredReason="run_ended"
        />
      )

      expect(screen.getByText('Closed with no answer.')).toBeInTheDocument()
      expect(screen.queryByText('Timed out with no answer.')).not.toBeInTheDocument()
    })

    it('shows the RPC error inline on a failed answer', async () => {
      workflowRunAnswerMock.mockRejectedValue(new Error('runtime_unavailable'))
      render(<QuestionCard question={approvalQuestion()} settings={settings} />)

      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

      await waitFor(() => expect(screen.getByText('runtime_unavailable')).toBeInTheDocument())
    })

    it('shows friendly copy and disables the buttons after a method_not_found answer (review round 1, minor)', async () => {
      workflowRunAnswerMock.mockRejectedValue(methodNotFoundError())
      render(<QuestionCard question={approvalQuestion()} settings={settings} />)

      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

      await waitFor(() =>
        expect(screen.getByText("Answering isn't available on this host yet.")).toBeInTheDocument()
      )
      expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
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

    it('flags an escalated agent question without the destructive treatment', () => {
      render(<QuestionCard question={agentQuestion({ state: 'escalated' })} settings={settings} />)

      const badge = screen.getByText('Escalated')
      expect(badge).toHaveAttribute('data-variant', 'review')
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

    it('shows a closed note instead of a timeout note when the run ended first', () => {
      render(
        <QuestionCard
          question={agentQuestion({ state: 'expired' })}
          settings={settings}
          expiredReason="run_ended"
        />
      )

      expect(screen.getByText('Closed with no answer.')).toBeInTheDocument()
    })

    it('shows friendly copy and disables answering after a method_not_found answer', async () => {
      workflowRunAnswerMock.mockRejectedValue(methodNotFoundError())
      render(<QuestionCard question={agentQuestion()} settings={settings} />)

      fireEvent.change(screen.getByPlaceholderText('Type your answer…'), {
        target: { value: 'Use the additive migration.' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Answer' }))

      await waitFor(() =>
        expect(screen.getByText("Answering isn't available on this host yet.")).toBeInTheDocument()
      )
      expect(screen.getByRole('button', { name: 'Answer' })).toBeDisabled()
      expect(screen.getByPlaceholderText('Type your answer…')).toBeDisabled()
    })
  })
})
