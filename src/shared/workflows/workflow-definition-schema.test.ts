import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'
import { parseWorkflowDefinition } from './workflow-definition-schema'

const FIXTURES_DIR = resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', 'workflows')

type RawNode = Record<string, unknown>
type RawWorkflow = Record<string, unknown> & { nodes: RawNode[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function minimalWorkflow(): RawWorkflow {
  return {
    version: 1,
    name: 'test-workflow',
    workspacePolicy: 'run-workspace',
    roles: {
      dev: { name: 'Dev', agent: 'claude', systemPrompt: 'Do the work.', skills: [] }
    },
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      {
        id: 'work',
        type: 'agent',
        title: 'Work',
        roleId: 'dev',
        prompt: 'go',
        workspace: 'run',
        resultContract: { type: 'object' },
        artifacts: [],
        question: { timeoutMs: 1, escalationGraceMs: 1 }
      },
      {
        id: 'loop',
        type: 'loop',
        title: 'Loop',
        body: { nodeIds: ['work'] },
        entryNodeId: 'work',
        exitNodeId: 'work',
        maxIterations: 3,
        exitCondition: { path: 'done', op: 'truthy' },
        onCapReached: 'fail'
      },
      { id: 'join', type: 'join', title: 'Join', policy: { quorum: 1 }, onFailure: 'fail' },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'loop' },
      { id: 'e2', from: 'loop', to: 'join', fromPort: 'exit' },
      { id: 'e3', from: 'join', to: 'end' }
    ],
    layout: {
      start: { x: 0, y: 0 },
      work: { x: 100, y: 0 },
      loop: { x: 200, y: 0 },
      join: { x: 300, y: 0 },
      end: { x: 400, y: 0 }
    }
  }
}

function withNode(workflow: RawWorkflow, id: string, patch: Record<string, unknown>): RawWorkflow {
  const nodes = workflow.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node))
  return { ...workflow, nodes }
}

function omitFromNode(workflow: RawWorkflow, id: string, key: string): RawWorkflow {
  const nodes = workflow.nodes.map((node) => {
    if (node.id !== id) {
      return node
    }
    const { [key]: _removed, ...rest } = node
    return rest
  })
  return { ...workflow, nodes }
}

describe('parseWorkflowDefinition: version', () => {
  it('rejects a workflow with no version field', () => {
    const { definition, problems } = parseWorkflowDefinition({
      ...minimalWorkflow(),
      version: undefined
    })
    expect(definition).toBeUndefined()
    expect(problems).toEqual([
      expect.objectContaining({ code: 'workflow_file_version_unsupported', severity: 'error' })
    ])
  })

  it('rejects an unknown version with workflow_file_version_unsupported', () => {
    const { definition, problems } = parseWorkflowDefinition({ ...minimalWorkflow(), version: 2 })
    expect(definition).toBeUndefined()
    expect(problems).toEqual([
      expect.objectContaining({ code: 'workflow_file_version_unsupported', severity: 'error' })
    ])
  })
})

describe('parseWorkflowDefinition: loop node', () => {
  it('rejects a loop without maxIterations', () => {
    const raw = omitFromNode(minimalWorkflow(), 'loop', 'maxIterations')
    const { definition, problems } = parseWorkflowDefinition(raw)
    expect(definition).toBeUndefined()
    expect(problems.some((problem) => problem.severity === 'error')).toBe(true)
  })

  it('rejects maxIterations below 1', () => {
    const raw = withNode(minimalWorkflow(), 'loop', { maxIterations: 0 })
    expect(parseWorkflowDefinition(raw).definition).toBeUndefined()
  })

  it('accepts maxIterations of exactly 1', () => {
    const raw = withNode(minimalWorkflow(), 'loop', { maxIterations: 1 })
    expect(parseWorkflowDefinition(raw).definition).toBeDefined()
  })
})

describe('parseWorkflowDefinition: join node', () => {
  it('rejects a non-positive quorum', () => {
    expect(
      parseWorkflowDefinition(withNode(minimalWorkflow(), 'join', { policy: { quorum: 0 } }))
        .definition
    ).toBeUndefined()
  })

  it('rejects a non-integer quorum', () => {
    expect(
      parseWorkflowDefinition(withNode(minimalWorkflow(), 'join', { policy: { quorum: 1.5 } }))
        .definition
    ).toBeUndefined()
  })

  it('accepts a positive integer quorum', () => {
    const { definition } = parseWorkflowDefinition(
      withNode(minimalWorkflow(), 'join', { policy: { quorum: 2 } })
    )
    expect(definition).toBeDefined()
  })
})

describe('parseWorkflowDefinition: unknown keys', () => {
  it('preserves an unrecognized top-level key and reports it as a warning, not an error', () => {
    const raw = { ...minimalWorkflow(), futureField: 'kept-for-round-trip' }
    const { definition, problems } = parseWorkflowDefinition(raw)
    expect(definition).toBeDefined()
    const widened: unknown = definition
    expect(isRecord(widened) && widened.futureField).toBe('kept-for-round-trip')
    expect(problems).toEqual([
      expect.objectContaining({ code: 'workflow_unknown_key', severity: 'warning' })
    ])
  })
})

describe('parseWorkflowDefinition: fixtures', () => {
  it.each(['feature-with-qa.workflow.yaml', 'two-node.workflow.yaml'])(
    'parses %s with no problems',
    (fileName) => {
      const raw = parseYaml(readFileSync(resolve(FIXTURES_DIR, fileName), 'utf8'))
      const { definition, problems } = parseWorkflowDefinition(raw)
      expect(problems).toEqual([])
      expect(definition).toBeDefined()
    }
  )
})
