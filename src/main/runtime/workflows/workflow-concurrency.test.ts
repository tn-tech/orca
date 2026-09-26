import { describe, expect, it } from 'vitest'
import type { Node, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import type { IterationNode } from './workflow-loop-unrolling'
import {
  admitByConcurrency,
  countInFlightAttempts,
  DEFAULT_WORKFLOW_CONCURRENCY_LIMIT,
  resolveConcurrencyLimit
} from './workflow-concurrency'

function agentNode(id: string): Node {
  return {
    id,
    type: 'agent',
    title: id,
    prompt: 'do it',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 1000, escalationGraceMs: 1000 }
  }
}

const WORKFLOW: Workflow = {
  version: 1,
  name: 'fan-out',
  workspacePolicy: 'run-workspace',
  roles: {},
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    agentNode('a'),
    agentNode('b'),
    agentNode('c'),
    { id: 'end', type: 'end', title: 'Done' }
  ],
  edges: [],
  layout: {}
}

function attempt(
  nodeId: string,
  nodeType: Node['type'],
  state: NodeAttemptView['state']
): Pick<NodeAttemptView, 'nodeType' | 'state'> & { nodeId: string } {
  return { nodeId, nodeType, state }
}

describe('resolveConcurrencyLimit', () => {
  it('defaults to 4 when neither an override nor the workflow file sets one', () => {
    expect(resolveConcurrencyLimit({ concurrencyLimit: undefined })).toBe(4)
    expect(resolveConcurrencyLimit({ concurrencyLimit: undefined })).toBe(
      DEFAULT_WORKFLOW_CONCURRENCY_LIMIT
    )
  })

  it('falls back to the workflow file value when no override is given', () => {
    expect(resolveConcurrencyLimit({ concurrencyLimit: 8 })).toBe(8)
  })

  it('lets workflow.run.start overrides.concurrencyLimit win over the workflow file', () => {
    expect(resolveConcurrencyLimit({ concurrencyLimit: 8 }, 2)).toBe(2)
  })
})

describe('countInFlightAttempts', () => {
  it('counts only worker-dispatching node types in a non-terminal state', () => {
    const attempts = [
      attempt('a', 'agent', 'running'),
      attempt('b', 'agent', 'pending'),
      attempt('c', 'agent', 'completed'),
      attempt('start', 'start', 'completed'),
      attempt('loop', 'loop', 'running'),
      attempt('join', 'join', 'waiting')
    ]
    expect(countInFlightAttempts(attempts)).toBe(2)
  })

  it.each(['provisioning', 'waiting', 'unverifiable'] as const)(
    'treats %s as in flight',
    (state) => {
      expect(countInFlightAttempts([attempt('a', 'agent', state)])).toBe(1)
    }
  )

  it.each(['failed', 'skipped', 'cancelled'] as const)('excludes terminal state %s', (state) => {
    expect(countInFlightAttempts([attempt('a', 'agent', state)])).toBe(0)
  })
})

describe('admitByConcurrency', () => {
  const eligible: IterationNode[] = [
    { nodeId: 'a', iteration: 0 },
    { nodeId: 'b', iteration: 0 },
    { nodeId: 'c', iteration: 0 }
  ]

  it('admits at most the concurrency limit and queues the rest (US3 AS1)', () => {
    const { launchable, blocked } = admitByConcurrency(WORKFLOW, eligible, [], 2)
    expect(launchable).toEqual([
      { nodeId: 'a', iteration: 0 },
      { nodeId: 'b', iteration: 0 }
    ])
    expect(blocked).toEqual([{ nodeId: 'c', iteration: 0 }])
  })

  it('never gates node types that settle inline (start/end/loop/join)', () => {
    const structural: IterationNode[] = [
      { nodeId: 'start', iteration: 0 },
      { nodeId: 'end', iteration: 0 }
    ]
    const busy = [attempt('a', 'agent', 'running'), attempt('b', 'agent', 'running')]
    const { launchable, blocked } = admitByConcurrency(WORKFLOW, structural, busy, 2)
    expect(launchable).toEqual(structural)
    expect(blocked).toEqual([])
  })

  it('counts already in-flight attempts against the same budget', () => {
    const attempts = [attempt('x', 'agent', 'running')]
    const { launchable, blocked } = admitByConcurrency(WORKFLOW, eligible, attempts, 2)
    expect(launchable).toEqual([{ nodeId: 'a', iteration: 0 }])
    expect(blocked).toEqual([
      { nodeId: 'b', iteration: 0 },
      { nodeId: 'c', iteration: 0 }
    ])
  })

  it('admits a previously queued node once a slot frees (queued attempts start as slots free)', () => {
    const stillEligible: IterationNode[] = [{ nodeId: 'c', iteration: 0 }]
    // a and b launched last pass; a has since completed, freeing the slot c was queued behind.
    const attempts = [attempt('a', 'agent', 'completed'), attempt('b', 'agent', 'running')]
    const { launchable, blocked } = admitByConcurrency(WORKFLOW, stillEligible, attempts, 2)
    expect(launchable).toEqual(stillEligible)
    expect(blocked).toEqual([])
  })
})
