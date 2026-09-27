import { describe, expect, it } from 'vitest'
import {
  approvalQuestionOptions,
  approvalQuestionSubject
} from './workflow-approval-question-subject'
import type { JsonValue } from './workflow-condition-schema'
import type { RunQuestionView } from './workflow-run-types'

function question(kind: RunQuestionView['kind'], optionsJson: JsonValue): RunQuestionView {
  return {
    id: 'wfq_1',
    runId: 'wfr_1',
    attemptId: 'wfa_1',
    kind,
    prompt: 'Approve?',
    optionsJson,
    state: 'pending'
  }
}

describe('approvalQuestionSubject', () => {
  it('round-trips the options and default, with one choice per option', () => {
    const optionsJson = approvalQuestionOptions({
      options: ['approve', 'reject'],
      defaultOption: 'reject'
    })
    expect(optionsJson).toMatchObject({
      choices: [
        { id: 'approve', label: 'approve' },
        { id: 'reject', label: 'reject' }
      ]
    })
    expect(approvalQuestionSubject(question('approval', optionsJson))).toEqual({
      options: ['approve', 'reject'],
      defaultOption: 'reject'
    })
  })

  it('drops a default that is not one of the options', () => {
    const optionsJson = { approval: { options: ['approve'], defaultOption: 'maybe' } }
    expect(approvalQuestionSubject(question('approval', optionsJson))).toEqual({
      options: ['approve']
    })
  })

  it('reads nothing from other kinds or malformed payloads', () => {
    const optionsJson = approvalQuestionOptions({ options: ['approve'] })
    expect(approvalQuestionSubject(question('trust', optionsJson))).toBeUndefined()
    expect(approvalQuestionSubject(question('approval', []))).toBeUndefined()
    expect(approvalQuestionSubject(question('approval', { approval: { options: [] } }))).toBe(
      undefined
    )
  })
})
