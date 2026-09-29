// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRunSnapshotView } from '@/runtime/runtime-workflow-client'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import type {
  NodeAttemptView,
  RunQuestionView
} from '../../../../../shared/workflows/workflow-run-types'

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowRunAnswer: vi.fn(),
  workflowTrustDecide: vi.fn()
}))

import RunPendingPrompts from './RunPendingPrompts'

afterEach(cleanup)

const settings = { activeRuntimeEnvironmentId: null }

const definition: Workflow = {
  version: 1,
  name: 'wf',
  workspacePolicy: 'run-workspace',
  roles: {},
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    {
      id: 'gate',
      type: 'approval',
      title: 'Ship gate',
      question: 'Ship?',
      options: ['yes'],
      timeoutMs: 1000,
      escalationGraceMs: 1000
    },
    { id: 'end', type: 'end', title: 'End' }
  ],
  edges: [],
  layout: {}
}

function attempt(): NodeAttemptView {
  return {
    id: 'attempt-1',
    runId: 'run-1',
    nodeId: 'gate',
    nodeType: 'approval',
    iteration: 0,
    attemptIndex: 0,
    state: 'waiting',
    artifactsJson: []
  }
}

function question(patch: Partial<RunQuestionView> = {}): RunQuestionView {
  return {
    id: 'q-1',
    runId: 'run-1',
    attemptId: 'attempt-1',
    kind: 'approval',
    prompt: 'Ship it to production?',
    optionsJson: { choices: [{ id: 'yes', label: 'Yes' }] },
    state: 'pending',
    ...patch
  }
}

function snapshot(questions: RunQuestionView[]): WorkflowRunSnapshotView {
  return {
    id: 'run-1',
    workflowName: 'wf',
    workflowSource: 'project',
    workflowSnapshot: definition,
    workflowVersion: 'rev-1',
    objective: 'ship',
    repoId: 'repo-1',
    state: 'waiting',
    concurrencyLimit: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    attempts: [attempt()],
    questions,
    messages: [],
    events: []
  }
}

describe('RunPendingPrompts', () => {
  it('lists a pending question with its node title without any node being selected (F9)', () => {
    render(
      <RunPendingPrompts
        definition={definition}
        snapshot={snapshot([question()])}
        settings={settings}
        onSelectNode={vi.fn()}
      />
    )

    expect(screen.getByText('Ship gate')).toBeInTheDocument()
    expect(screen.getByText('Ship it to production?')).toBeInTheDocument()
  })

  it('renders nothing when every question is settled', () => {
    const { container } = render(
      <RunPendingPrompts
        definition={definition}
        snapshot={snapshot([question({ state: 'answered', answer: 'yes' })])}
        settings={settings}
        onSelectNode={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('jumps to the waiting node on request', () => {
    const onSelectNode = vi.fn()
    render(
      <RunPendingPrompts
        definition={definition}
        snapshot={snapshot([question({ state: 'escalated' })])}
        settings={settings}
        onSelectNode={onSelectNode}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Ship gate' }))
    expect(onSelectNode).toHaveBeenCalledWith('gate')
  })
})
