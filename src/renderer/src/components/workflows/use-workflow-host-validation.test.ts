// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../shared/workflows/workflow-definition-types'

const { workflowValidateMock } = vi.hoisted(() => ({ workflowValidateMock: vi.fn() }))
vi.mock('@/runtime/runtime-workflow-client', () => ({ workflowValidate: workflowValidateMock }))

import {
  HOST_VALIDATION_FAILED_CODE,
  useWorkflowHostValidation
} from './use-workflow-host-validation'

const settings = { activeRuntimeEnvironmentId: null }
const hostProblem: WorkflowProblem = {
  code: 'graph_skill_source_not_allowlisted',
  message: 'Skill "x" is not allowlisted.',
  severity: 'error'
}

function definition(name = 'wf'): Workflow {
  return {
    version: 1,
    name,
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [{ id: 'start', type: 'start', title: 'Start' }],
    edges: [],
    layout: {}
  }
}

type Props = { definition: Workflow | null; storable: boolean }

function renderValidation(initial: Props) {
  return renderHook(
    (props: Props) => useWorkflowHostValidation({ settings, repoId: 'repo-1', ...props }),
    { initialProps: initial }
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  workflowValidateMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useWorkflowHostValidation', () => {
  it('returns the host problems after the debounce', async () => {
    workflowValidateMock.mockResolvedValue({ problems: [hostProblem] })
    const { result } = renderValidation({ definition: definition(), storable: true })

    await settle()

    expect(result.current).toEqual([hostProblem])
  })

  it('shows a failed host check as a warning instead of swallowing it, and drops stale problems', async () => {
    workflowValidateMock.mockResolvedValueOnce({ problems: [hostProblem] })
    const { result, rerender } = renderValidation({ definition: definition(), storable: true })
    await settle()
    expect(result.current).toEqual([hostProblem])

    workflowValidateMock.mockRejectedValueOnce(new Error('connection lost'))
    rerender({ definition: definition('wf-2'), storable: true })
    await settle()

    expect(result.current).toEqual([
      expect.objectContaining({
        code: HOST_VALIDATION_FAILED_CODE,
        severity: 'warning',
        message: expect.stringContaining('connection lost')
      })
    ])
  })

  it('skips the host call for a definition the host cannot parse, clearing earlier results', async () => {
    workflowValidateMock.mockResolvedValue({ problems: [hostProblem] })
    const { result, rerender } = renderValidation({ definition: definition(), storable: true })
    await settle()
    expect(result.current).toEqual([hostProblem])

    rerender({ definition: definition('wf-2'), storable: false })
    await settle()

    expect(workflowValidateMock).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual([])
  })
})
