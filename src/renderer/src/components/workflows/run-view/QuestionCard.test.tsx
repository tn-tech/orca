// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunQuestionView } from '../../../../../shared/workflows/workflow-run-types'
import QuestionCard from './QuestionCard'

const { workflowTrustDecideMock } = vi.hoisted(() => ({ workflowTrustDecideMock: vi.fn() }))

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowTrustDecide: workflowTrustDecideMock
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  workflowTrustDecideMock.mockReset()
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

  it('renders nothing for a trust question whose payload does not match the documented shape', () => {
    const { container } = render(
      <QuestionCard question={trustQuestion({ optionsJson: {} })} settings={settings} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('falls back to a plain prompt for question kinds without an answer flow yet (US5)', () => {
    render(
      <QuestionCard
        question={trustQuestion({
          kind: 'approval',
          prompt: 'Approve the plan?',
          optionsJson: null
        })}
        settings={settings}
      />
    )

    expect(screen.getByText('Waiting on you')).toBeInTheDocument()
    expect(screen.getByText('Approve the plan?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
  })
})
