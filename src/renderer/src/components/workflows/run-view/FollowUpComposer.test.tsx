// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunMessageView } from '../../../../../shared/workflows/workflow-run-types'
import FollowUpComposer from './FollowUpComposer'

const { workflowRunSendMessageMock } = vi.hoisted(() => ({
  workflowRunSendMessageMock: vi.fn()
}))

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowRunSendMessage: workflowRunSendMessageMock
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  workflowRunSendMessageMock.mockReset()
})

const settings = { activeRuntimeEnvironmentId: null }

function message(patch: Partial<RunMessageView> = {}): RunMessageView {
  return {
    id: 'message-1',
    runId: 'run-1',
    attemptId: 'attempt-1',
    sender: 'rami',
    text: 'Please double-check the migration order.',
    mode: 'queued',
    state: 'queued',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch
  }
}

describe('FollowUpComposer (FR-036/FR-036a)', () => {
  it('sends a message queued by default', async () => {
    workflowRunSendMessageMock.mockResolvedValue({ messageId: 'message-2' })
    render(
      <FollowUpComposer runId="run-1" attemptId="attempt-1" messages={[]} settings={settings} />
    )

    fireEvent.change(screen.getByPlaceholderText('Message the running agent…'), {
      target: { value: 'Check the config too.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(workflowRunSendMessageMock).toHaveBeenCalledWith(settings, {
        runId: 'run-1',
        attemptId: 'attempt-1',
        text: 'Check the config too.',
        mode: 'queued'
      })
    )
  })

  it('sends a message immediately through the explicit "Interrupt now" action', async () => {
    workflowRunSendMessageMock.mockResolvedValue({ messageId: 'message-2' })
    render(
      <FollowUpComposer runId="run-1" attemptId="attempt-1" messages={[]} settings={settings} />
    )

    fireEvent.change(screen.getByPlaceholderText('Message the running agent…'), {
      target: { value: 'Stop and check with me now.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt now' }))

    await waitFor(() =>
      expect(workflowRunSendMessageMock).toHaveBeenCalledWith(settings, {
        runId: 'run-1',
        attemptId: 'attempt-1',
        text: 'Stop and check with me now.',
        mode: 'interrupt'
      })
    )
  })

  it('clears the draft after a successful send', async () => {
    workflowRunSendMessageMock.mockResolvedValue({ messageId: 'message-2' })
    render(
      <FollowUpComposer runId="run-1" attemptId="attempt-1" messages={[]} settings={settings} />
    )

    const textarea = screen.getByPlaceholderText('Message the running agent…')
    fireEvent.change(textarea, { target: { value: 'Check the config too.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(textarea).toHaveValue(''))
  })

  it('does not send a blank message', () => {
    render(
      <FollowUpComposer runId="run-1" attemptId="attempt-1" messages={[]} settings={settings} />
    )

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Interrupt now' })).toBeDisabled()
    expect(workflowRunSendMessageMock).not.toHaveBeenCalled()
  })

  it('shows the RPC error inline and keeps the draft on failure', async () => {
    workflowRunSendMessageMock.mockRejectedValue(new Error('runtime_unavailable'))
    render(
      <FollowUpComposer runId="run-1" attemptId="attempt-1" messages={[]} settings={settings} />
    )

    const textarea = screen.getByPlaceholderText('Message the running agent…')
    fireEvent.change(textarea, { target: { value: 'Check the config too.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByText('runtime_unavailable')).toBeInTheDocument())
    expect(textarea).toHaveValue('Check the config too.')
  })

  it('shows each message with its delivery state', () => {
    render(
      <FollowUpComposer
        runId="run-1"
        attemptId="attempt-1"
        messages={[
          message({ id: 'm1', state: 'queued', mode: 'queued' }),
          message({
            id: 'm2',
            text: 'Actually go ahead.',
            state: 'delivered',
            mode: 'interrupt',
            deliveredAt: '2026-01-01T00:05:00.000Z'
          })
        ]}
        settings={settings}
      />
    )

    expect(screen.getByText('Please double-check the migration order.')).toBeInTheDocument()
    expect(screen.getByText(/Undelivered/)).toBeInTheDocument()
    expect(screen.getByText('Actually go ahead.')).toBeInTheDocument()
    expect(screen.getByText(/Delivered/)).toBeInTheDocument()
  })
})
