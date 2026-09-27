import { describe, expect, it } from 'vitest'
import type { RunQuestionView } from './workflow-run-types'
import { agentQuestionContext } from './workflow-agent-question-subject'

function question(
  kind: RunQuestionView['kind'],
  optionsJson: RunQuestionView['optionsJson']
): RunQuestionView {
  return {
    id: 'question-1',
    runId: 'run-1',
    attemptId: 'attempt-1',
    kind,
    prompt: 'Which migration strategy should I use?',
    optionsJson,
    state: 'pending'
  }
}

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
