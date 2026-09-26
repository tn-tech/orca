import { describe, expect, it } from 'vitest'
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { Node } from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../shared/workflows/workflow-node-states'
import { computeFrontier } from './workflow-frontier'
import { agent, end, start, workflow } from './workflow-frontier-test-fixtures'
import {
  computeLoopProgress,
  loopPreviousInputs,
  type LoopProgressAttempt
} from './workflow-loop-unrolling'

const qaLoop: Node = {
  id: 'qa',
  type: 'loop',
  title: 'QA loop',
  body: { nodeIds: ['implement', 'review'] },
  entryNodeId: 'implement',
  exitNodeId: 'review',
  maxIterations: 3,
  exitCondition: { path: 'approved', op: 'eq', value: true },
  onCapReached: 'fail'
}

const def = workflow(
  [start, qaLoop, agent('implement'), agent('review'), end],
  [
    { id: 'e1', from: 'start', to: 'qa' },
    { id: 'e2', from: 'implement', to: 'review' },
    { id: 'e3', from: 'review', to: 'implement', fromPort: 'body' },
    { id: 'e4', from: 'qa', to: 'end', fromPort: 'exit' }
  ]
)

function at(
  nodeId: string,
  state: WorkflowAttemptState,
  iteration = 0,
  resultJson?: JsonValue
): LoopProgressAttempt {
  return {
    id: `${nodeId}#${iteration}`,
    nodeId,
    iteration,
    attemptIndex: 0,
    state,
    ...(resultJson === undefined ? {} : { resultJson })
  }
}

const rejected = (n: number): JsonValue => ({ approved: false, findings: [`issue ${n}`] })
const started = [at('start', 'completed'), at('qa', 'running')]

describe('computeLoopProgress', () => {
  it('offers the Loop node to the main frontier once its incoming edge fires', () => {
    expect(computeFrontier(def, [at('start', 'completed')])).toEqual({
      eligible: ['qa'],
      skipped: []
    })
    expect(computeLoopProgress(def, [at('start', 'completed')])).toEqual({
      eligible: [],
      skipped: [],
      iterationStarts: [],
      settlements: []
    })
  })

  it('starts iteration 0 at the entry node through the implicit loop-entry edge', () => {
    expect(computeLoopProgress(def, started)).toEqual({
      eligible: [{ nodeId: 'implement', iteration: 0 }],
      skipped: [],
      iterationStarts: [{ loopId: 'qa', attemptId: 'qa#0', iteration: 0, exitResult: null }],
      settlements: []
    })
  })

  it('runs body nodes within one iteration in edge order and waits on active ones', () => {
    const afterImplement = [...started, at('implement', 'completed', 0, { summary: 'x' })]
    expect(computeLoopProgress(def, afterImplement).eligible).toEqual([
      { nodeId: 'review', iteration: 0 }
    ])
    const reviewing = [...afterImplement, at('review', 'running')]
    expect(computeLoopProgress(def, reviewing)).toEqual({
      eligible: [],
      skipped: [],
      iterationStarts: [],
      settlements: []
    })
  })

  it('iterates when the exit condition is false and the cap leaves room', () => {
    const attempts = [
      ...started,
      at('implement', 'completed', 0, { summary: 'x' }),
      at('review', 'completed', 0, rejected(0))
    ]
    expect(computeLoopProgress(def, attempts)).toEqual({
      eligible: [{ nodeId: 'implement', iteration: 1 }],
      skipped: [],
      iterationStarts: [{ loopId: 'qa', attemptId: 'qa#0', iteration: 1, exitResult: rejected(0) }],
      settlements: []
    })
    // Iteration 1 bookkeeping reads only iteration-1 attempts: review is not yet eligible.
    const second = [...attempts, at('implement', 'completed', 1, { summary: 'y' })]
    expect(computeLoopProgress(def, second).eligible).toEqual([{ nodeId: 'review', iteration: 1 }])
  })

  it('exits when the exit condition is true', () => {
    const approved = { approved: true, findings: [] }
    const attempts = [
      ...started,
      at('implement', 'completed', 0),
      at('review', 'completed', 0, rejected(0)),
      at('implement', 'completed', 1),
      at('review', 'completed', 1, approved)
    ]
    expect(computeLoopProgress(def, attempts).settlements).toEqual([
      { loopId: 'qa', attemptId: 'qa#0', outcome: 'exited', iterations: 2, exitResult: approved }
    ])
    expect(computeLoopProgress(def, attempts).eligible).toEqual([])
  })

  it('fails with loop_cap_reached when the cap is reached without the exit condition', () => {
    const attempts = [...started]
    for (let iteration = 0; iteration < 3; iteration += 1) {
      attempts.push(at('implement', 'completed', iteration))
      attempts.push(at('review', 'completed', iteration, rejected(iteration)))
    }
    expect(computeLoopProgress(def, attempts)).toEqual({
      eligible: [],
      skipped: [],
      iterationStarts: [],
      settlements: [
        {
          loopId: 'qa',
          attemptId: 'qa#0',
          outcome: 'cap_reached',
          iterations: 3,
          exitResult: rejected(2)
        }
      ]
    })
  })

  it('skips the rest of a failed iteration, then fails the loop', () => {
    const failed = [...started, at('implement', 'failed')]
    expect(computeLoopProgress(def, failed).skipped).toEqual([{ nodeId: 'review', iteration: 0 }])
    expect(computeLoopProgress(def, [...failed, at('review', 'skipped')]).settlements).toEqual([
      { loopId: 'qa', attemptId: 'qa#0', outcome: 'body_failed', iterations: 1, exitResult: null }
    ])
    // A failed body node fails the loop even when the exit node completed on another branch.
    const approved = { approved: true, findings: [] }
    expect(
      computeLoopProgress(def, [...failed, at('review', 'completed', 0, approved)]).settlements
    ).toMatchObject([{ outcome: 'body_failed', exitResult: approved }])
  })

  it('ignores settled loops', () => {
    expect(computeLoopProgress(def, [at('start', 'completed'), at('qa', 'completed')])).toEqual({
      eligible: [],
      skipped: [],
      iterationStarts: [],
      settlements: []
    })
  })
})

describe('Loop exit port in the main frontier', () => {
  it('fires exit-port edges when the loop completes and blocks them when it fails', () => {
    expect(computeFrontier(def, [at('start', 'completed'), at('qa', 'running')]).eligible).toEqual(
      []
    )
    expect(computeFrontier(def, [at('start', 'completed'), at('qa', 'completed')])).toEqual({
      eligible: ['end'],
      skipped: []
    })
    expect(computeFrontier(def, [at('start', 'completed'), at('qa', 'failed')])).toEqual({
      eligible: [],
      skipped: ['end']
    })
  })
})

describe('loopPreviousInputs', () => {
  const attempts = [
    ...started,
    at('implement', 'completed', 0, { summary: 'first' }),
    at('review', 'completed', 0, rejected(0)),
    at('implement', 'completed', 1, { summary: 'second' })
  ]

  it('exposes the previous iteration results of every body node', () => {
    expect(loopPreviousInputs(def, attempts, 'review', 1)).toEqual({
      implement: { result: { summary: 'first' } },
      review: { result: rejected(0) }
    })
  })

  it('is empty on the first iteration and absent outside a loop body', () => {
    expect(loopPreviousInputs(def, attempts, 'implement', 0)).toEqual({})
    expect(loopPreviousInputs(def, attempts, 'end', 0)).toBeUndefined()
  })
})
