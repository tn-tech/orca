import { describe, expect, it } from 'vitest'
import type { RunQuestionView } from './workflow-run-types'
import { trustQuestionSubject } from './workflow-trust-question-subject'

function trustQuestion(optionsJson: RunQuestionView['optionsJson']): RunQuestionView {
  return {
    id: 'question-1',
    runId: 'run-1',
    attemptId: 'attempt-1',
    kind: 'trust',
    prompt: 'Trust plugin source "speckit" on host local?',
    optionsJson,
    state: 'pending'
  }
}

describe('trustQuestionSubject', () => {
  it('decodes the documented shape', () => {
    expect(
      trustQuestionSubject(
        trustQuestion({
          choices: [],
          trust: {
            source: 'speckit',
            host: 'ssh:devbox',
            skills: ['speckit-plan'],
            agents: ['claude']
          }
        })
      )
    ).toEqual({
      source: 'speckit',
      host: 'ssh:devbox',
      skills: ['speckit-plan'],
      agents: ['claude']
    })
  })

  it('defaults missing skills/agents to empty arrays and drops non-string entries', () => {
    expect(
      trustQuestionSubject(
        trustQuestion({
          trust: { source: 'speckit', host: 'local', skills: ['ok', 1], agents: null }
        })
      )
    ).toEqual({ source: 'speckit', host: 'local', skills: ['ok'], agents: [] })
  })

  it('returns undefined for a non-trust question kind', () => {
    const question = trustQuestion({ trust: { source: 's', host: 'local' } })
    expect(trustQuestionSubject({ ...question, kind: 'approval' })).toBeUndefined()
  })

  it('returns undefined for a malformed or missing payload', () => {
    expect(trustQuestionSubject(trustQuestion(null))).toBeUndefined()
    expect(trustQuestionSubject(trustQuestion([]))).toBeUndefined()
    expect(trustQuestionSubject(trustQuestion({}))).toBeUndefined()
    expect(trustQuestionSubject(trustQuestion({ trust: [] }))).toBeUndefined()
    expect(trustQuestionSubject(trustQuestion({ trust: { source: 's' } }))).toBeUndefined()
    expect(trustQuestionSubject(trustQuestion({ trust: { host: 'local' } }))).toBeUndefined()
  })
})
