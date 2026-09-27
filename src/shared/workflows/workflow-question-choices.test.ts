import { describe, expect, it } from 'vitest'
import type { RunQuestionView } from './workflow-run-types'
import { agentQuestionContext, approvalQuestionChoices } from './workflow-question-choices'

function question(
  kind: RunQuestionView['kind'],
  optionsJson: RunQuestionView['optionsJson']
): RunQuestionView {
  return {
    id: 'question-1',
    runId: 'run-1',
    attemptId: 'attempt-1',
    kind,
    prompt: 'Approve the plan?',
    optionsJson,
    state: 'pending'
  }
}

describe('approvalQuestionChoices', () => {
  it('decodes the documented shape', () => {
    expect(
      approvalQuestionChoices(
        question('approval', {
          choices: [
            { id: 'Approve', label: 'Approve' },
            { id: 'Reject', label: 'Reject' }
          ]
        })
      )
    ).toEqual([
      { id: 'Approve', label: 'Approve' },
      { id: 'Reject', label: 'Reject' }
    ])
  })

  it('drops malformed entries but keeps the well-formed ones', () => {
    expect(
      approvalQuestionChoices(
        question('approval', {
          choices: [{ id: 'Approve', label: 'Approve' }, { id: 'Reject' }, 'not-an-object', null]
        })
      )
    ).toEqual([{ id: 'Approve', label: 'Approve' }])
  })

  it('returns undefined for a non-approval question kind', () => {
    expect(
      approvalQuestionChoices(
        question('trust', { choices: [{ id: 'trusted', label: 'Trust this source' }] })
      )
    ).toBeUndefined()
  })

  it('returns undefined for a malformed or missing payload', () => {
    expect(approvalQuestionChoices(question('approval', null))).toBeUndefined()
    expect(approvalQuestionChoices(question('approval', []))).toBeUndefined()
    expect(approvalQuestionChoices(question('approval', {}))).toBeUndefined()
    expect(approvalQuestionChoices(question('approval', { choices: [] }))).toBeUndefined()
    expect(approvalQuestionChoices(question('approval', { choices: 'nope' }))).toBeUndefined()
  })
})

describe('agentQuestionContext', () => {
  it('decodes a string context', () => {
    expect(
      agentQuestionContext(
        question('agent-question', { context: 'Deciding between two migration strategies.' })
      )
    ).toBe('Deciding between two migration strategies.')
  })

  it('returns undefined for a non-agent-question kind', () => {
    expect(agentQuestionContext(question('approval', { context: 'nope' }))).toBeUndefined()
  })

  it('returns undefined for a malformed or missing payload', () => {
    expect(agentQuestionContext(question('agent-question', null))).toBeUndefined()
    expect(agentQuestionContext(question('agent-question', {}))).toBeUndefined()
    expect(agentQuestionContext(question('agent-question', { context: 42 }))).toBeUndefined()
  })
})
