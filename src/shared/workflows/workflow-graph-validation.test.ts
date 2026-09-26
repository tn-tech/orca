import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'
import type {
  AgentNode,
  ApprovalNode,
  Edge,
  EndNode,
  JoinNode,
  LoopNode,
  Node,
  Role,
  RouterNode,
  StartNode,
  Workflow
} from './workflow-definition-types'
import { parseWorkflowDefinition } from './workflow-definition-schema'
import { validateWorkflowGraph, type GraphValidationContext } from './workflow-graph-validation'

const FIXTURES_DIR = resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', 'workflows')

const permissiveContext: GraphValidationContext = {
  agentSupportsModel: () => true,
  allowlistedSources: []
}

function role(patch: Partial<Role> = {}): Role {
  return {
    id: 'dev',
    name: 'Dev',
    agent: 'claude',
    systemPrompt: 'Do the work.',
    skills: [],
    ...patch
  }
}

function startNode(id = 'start'): StartNode {
  return { id, type: 'start', title: 'Start' }
}

function endNode(id = 'end'): EndNode {
  return { id, type: 'end', title: 'End' }
}

function agentNode(id: string, patch: Partial<AgentNode> = {}): AgentNode {
  return {
    id,
    type: 'agent',
    title: id,
    roleId: 'dev',
    prompt: 'go',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 1, escalationGraceMs: 1 },
    ...patch
  }
}

function routerNode(id: string, patch: Partial<RouterNode> = {}): RouterNode {
  return {
    id,
    type: 'router',
    title: id,
    roleId: 'dev',
    prompt: 'choose',
    choices: ['a', 'b'],
    ...patch
  }
}

function loopNode(id: string, patch: Partial<LoopNode> = {}): LoopNode {
  return {
    id,
    type: 'loop',
    title: id,
    body: { nodeIds: ['work'] },
    entryNodeId: 'work',
    exitNodeId: 'work',
    maxIterations: 3,
    exitCondition: { path: 'done', op: 'truthy' },
    onCapReached: 'fail',
    ...patch
  }
}

function joinNode(id: string, patch: Partial<JoinNode> = {}): JoinNode {
  return { id, type: 'join', title: id, policy: 'all', onFailure: 'fail', ...patch }
}

function approvalNode(id: string, patch: Partial<ApprovalNode> = {}): ApprovalNode {
  return {
    id,
    type: 'approval',
    title: id,
    question: 'Proceed?',
    options: ['approve', 'reject'],
    timeoutMs: 1,
    escalationGraceMs: 1,
    ...patch
  }
}

function edge(id: string, from: string, to: string, patch: Partial<Edge> = {}): Edge {
  return { id, from, to, ...patch }
}

function workflow(patch: Partial<Workflow> & { nodes: Node[]; edges: Edge[] }): Workflow {
  return {
    version: 1,
    name: 'test-workflow',
    workspacePolicy: 'run-workspace',
    roles: { dev: role() },
    layout: {},
    ...patch
  }
}

describe('validateWorkflowGraph: start and end', () => {
  it('accepts a minimal valid workflow with no problems', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('work'), endNode()],
      edges: [edge('e1', 'start', 'work'), edge('e2', 'work', 'end')]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toEqual([])
  })

  it('rejects a workflow with no Start node', () => {
    const wf = workflow({
      nodes: [agentNode('work'), endNode()],
      edges: [edge('e1', 'work', 'end')]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({ code: 'graph_missing_start', severity: 'error' })
    )
  })

  it('rejects a workflow with two Start nodes', () => {
    const wf = workflow({
      nodes: [startNode('start'), startNode('start2'), endNode()],
      edges: [edge('e1', 'start', 'end')]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_multiple_start_nodes',
        nodeId: 'start2',
        severity: 'error'
      })
    )
  })

  it('rejects a workflow with no End node', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('work')],
      edges: [edge('e1', 'start', 'work')]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({ code: 'graph_missing_end', severity: 'error' })
    )
  })
})

describe('validateWorkflowGraph: reachability', () => {
  it('rejects a node with no path from Start', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('work'), agentNode('orphan'), endNode()],
      edges: [edge('e1', 'start', 'work'), edge('e2', 'work', 'end')]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_unreachable_node',
        nodeId: 'orphan',
        severity: 'error'
      })
    )
  })

  it('treats a Loop node as reaching its entryNodeId even with no explicit edge', () => {
    const wf = workflow({
      nodes: [
        startNode(),
        loopNode('loop', {
          body: { nodeIds: ['implement', 'review'] },
          entryNodeId: 'implement',
          exitNodeId: 'review'
        }),
        agentNode('implement'),
        agentNode('review'),
        endNode()
      ],
      edges: [
        edge('e1', 'start', 'loop'),
        edge('e2', 'implement', 'review'),
        edge('e3', 'review', 'implement', { fromPort: 'body' }),
        edge('e4', 'loop', 'end', { fromPort: 'exit' })
      ]
    })
    const problems = validateWorkflowGraph(wf, permissiveContext)
    expect(problems.filter((p) => p.code === 'graph_unreachable_node')).toEqual([])
  })
})

describe('validateWorkflowGraph: cycles', () => {
  it('rejects a cycle outside any Loop body and reports the offending edge id', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('a'), agentNode('b'), endNode()],
      edges: [
        edge('e1', 'start', 'a'),
        edge('e2', 'a', 'b'),
        edge('e3', 'b', 'a'),
        edge('e4', 'b', 'end')
      ]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({ code: 'graph_cycle', edgeId: 'e3', severity: 'error' })
    )
  })

  it('does not flag a cycle formed entirely within a Loop body', () => {
    const wf = workflow({
      nodes: [
        startNode(),
        loopNode('loop', {
          body: { nodeIds: ['implement', 'review'] },
          entryNodeId: 'implement',
          exitNodeId: 'review'
        }),
        agentNode('implement'),
        agentNode('review'),
        endNode()
      ],
      edges: [
        edge('e1', 'start', 'loop'),
        edge('e2', 'implement', 'review'),
        edge('e3', 'review', 'implement', { fromPort: 'body' }),
        edge('e4', 'loop', 'end', { fromPort: 'exit' })
      ]
    })
    expect(
      validateWorkflowGraph(wf, permissiveContext).filter((p) => p.code === 'graph_cycle')
    ).toEqual([])
  })
})

describe('validateWorkflowGraph: loop nodes', () => {
  const baseNodes = (loop: LoopNode): Node[] => [
    startNode(),
    loop,
    agentNode('work'),
    agentNode('other'),
    endNode()
  ]
  const baseEdges: Edge[] = [
    edge('e1', 'start', 'loop'),
    edge('e2', 'loop', 'end', { fromPort: 'exit' })
  ]

  it('rejects a Loop with no maximum iteration count (the editor\'s "unset" sentinel)', () => {
    const wf = workflow({
      nodes: baseNodes(loopNode('loop', { maxIterations: 0 })),
      edges: baseEdges
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_loop_missing_max_iterations',
        nodeId: 'loop',
        severity: 'error'
      })
    )
  })

  it('accepts a Loop with maxIterations of exactly 1', () => {
    const wf = workflow({
      nodes: baseNodes(loopNode('loop', { maxIterations: 1 })),
      edges: baseEdges
    })
    expect(
      validateWorkflowGraph(wf, permissiveContext).filter(
        (p) => p.code === 'graph_loop_missing_max_iterations'
      )
    ).toEqual([])
  })

  it('rejects an entryNodeId that is not inside the body', () => {
    const wf = workflow({
      nodes: baseNodes(
        loopNode('loop', { body: { nodeIds: ['work'] }, entryNodeId: 'other', exitNodeId: 'work' })
      ),
      edges: baseEdges
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_loop_entry_not_in_body',
        nodeId: 'loop',
        severity: 'error'
      })
    )
  })

  it('rejects an exitNodeId that is not inside the body', () => {
    const wf = workflow({
      nodes: baseNodes(
        loopNode('loop', { body: { nodeIds: ['work'] }, entryNodeId: 'work', exitNodeId: 'other' })
      ),
      edges: baseEdges
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_loop_exit_not_in_body',
        nodeId: 'loop',
        severity: 'error'
      })
    )
  })

  it('rejects a body edge that leaves the loop without using a loop port', () => {
    const wf = workflow({
      nodes: [
        startNode(),
        loopNode('loop', { body: { nodeIds: ['work'] }, entryNodeId: 'work', exitNodeId: 'work' }),
        agentNode('work'),
        endNode()
      ],
      edges: [
        edge('e1', 'start', 'loop'),
        edge('e2', 'loop', 'end', { fromPort: 'exit' }),
        edge('e3', 'work', 'end')
      ]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_loop_body_edge_escapes',
        nodeId: 'loop',
        edgeId: 'e3',
        severity: 'error'
      })
    )
  })

  it('allows a body edge to leave via the exit port', () => {
    const wf = workflow({
      nodes: [
        startNode(),
        loopNode('loop', { body: { nodeIds: ['work'] }, entryNodeId: 'work', exitNodeId: 'work' }),
        agentNode('work'),
        endNode()
      ],
      edges: [edge('e1', 'start', 'loop'), edge('e2', 'work', 'end', { fromPort: 'exit' })]
    })
    expect(
      validateWorkflowGraph(wf, permissiveContext).filter(
        (p) => p.code === 'graph_loop_body_edge_escapes'
      )
    ).toEqual([])
  })
})

describe('validateWorkflowGraph: join nodes', () => {
  it('rejects a join with fewer than two incoming edges', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('a'), joinNode('join'), endNode()],
      edges: [edge('e1', 'start', 'a'), edge('e2', 'a', 'join'), edge('e3', 'join', 'end')]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_join_insufficient_incoming',
        nodeId: 'join',
        severity: 'error'
      })
    )
  })

  it('rejects a quorum greater than the incoming edge count', () => {
    const wf = workflow({
      nodes: [
        startNode(),
        agentNode('a'),
        agentNode('b'),
        joinNode('join', { policy: { quorum: 3 } }),
        endNode()
      ],
      edges: [
        edge('e1', 'start', 'a'),
        edge('e2', 'start', 'b'),
        edge('e3', 'a', 'join'),
        edge('e4', 'b', 'join'),
        edge('e5', 'join', 'end')
      ]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_join_quorum_exceeds_incoming',
        nodeId: 'join',
        severity: 'error'
      })
    )
  })

  it('accepts a quorum at or below the incoming edge count', () => {
    const wf = workflow({
      nodes: [
        startNode(),
        agentNode('a'),
        agentNode('b'),
        joinNode('join', { policy: { quorum: 2 } }),
        endNode()
      ],
      edges: [
        edge('e1', 'start', 'a'),
        edge('e2', 'start', 'b'),
        edge('e3', 'a', 'join'),
        edge('e4', 'b', 'join'),
        edge('e5', 'join', 'end')
      ]
    })
    const problems = validateWorkflowGraph(wf, permissiveContext)
    expect(problems.filter((p) => p.code.startsWith('graph_join'))).toEqual([])
  })
})

describe('validateWorkflowGraph: approval and router ports', () => {
  it('rejects an approval option with no outgoing edge', () => {
    const wf = workflow({
      nodes: [startNode(), approvalNode('gate'), endNode()],
      edges: [edge('e1', 'start', 'gate'), edge('e2', 'gate', 'end', { fromPort: 'approve' })]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_option_missing_edge',
        nodeId: 'gate',
        severity: 'error'
      })
    )
  })

  it('rejects an approval option with more than one outgoing edge', () => {
    const wf = workflow({
      nodes: [startNode(), approvalNode('gate'), endNode()],
      edges: [
        edge('e1', 'start', 'gate'),
        edge('e2', 'gate', 'end', { fromPort: 'approve' }),
        edge('e3', 'gate', 'end', { fromPort: 'approve' }),
        edge('e4', 'gate', 'end', { fromPort: 'reject' })
      ]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_option_duplicate_edge',
        nodeId: 'gate',
        edgeId: 'e3',
        severity: 'error'
      })
    )
  })

  it('rejects an edge from an approval node that is not tied to an option', () => {
    const wf = workflow({
      nodes: [startNode(), approvalNode('gate'), endNode()],
      edges: [
        edge('e1', 'start', 'gate'),
        edge('e2', 'gate', 'end', { fromPort: 'approve' }),
        edge('e3', 'gate', 'end', { fromPort: 'reject' }),
        edge('e4', 'gate', 'end')
      ]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_unexpected_edge',
        nodeId: 'gate',
        edgeId: 'e4',
        severity: 'error'
      })
    )
  })

  it('applies the same one-edge-per-option rule to a router choice', () => {
    const wf = workflow({
      nodes: [startNode(), routerNode('router'), endNode()],
      edges: [edge('e1', 'start', 'router'), edge('e2', 'router', 'end', { fromPort: 'a' })]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_option_missing_edge',
        nodeId: 'router',
        severity: 'error'
      })
    )
  })

  it('accepts an approval with exactly one edge per option', () => {
    const wf = workflow({
      nodes: [startNode(), approvalNode('gate'), endNode()],
      edges: [
        edge('e1', 'start', 'gate'),
        edge('e2', 'gate', 'end', { fromPort: 'approve' }),
        edge('e3', 'gate', 'end', { fromPort: 'reject' })
      ]
    })
    const problems = validateWorkflowGraph(wf, permissiveContext)
    expect(problems.filter((p) => p.nodeId === 'gate')).toEqual([])
  })
})

describe('validateWorkflowGraph: role references and model overrides', () => {
  it('rejects a node referencing an unknown roleId', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('work', { roleId: 'missing' }), endNode()],
      edges: [edge('e1', 'start', 'work'), edge('e2', 'work', 'end')]
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_unknown_role',
        nodeId: 'work',
        roleId: 'missing',
        severity: 'error'
      })
    )
  })

  it('rejects a model override when the agent has no model catalog', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('work', { overrides: { model: 'opus' } }), endNode()],
      edges: [edge('e1', 'start', 'work'), edge('e2', 'work', 'end')]
    })
    const context: GraphValidationContext = {
      agentSupportsModel: () => false,
      allowlistedSources: []
    }
    expect(validateWorkflowGraph(wf, context)).toContainEqual(
      expect.objectContaining({
        code: 'graph_model_override_not_supported',
        nodeId: 'work',
        roleId: 'dev',
        severity: 'error'
      })
    )
  })

  it('accepts a model override when the agent supports it', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('work', { overrides: { model: 'opus' } }), endNode()],
      edges: [edge('e1', 'start', 'work'), edge('e2', 'work', 'end')]
    })
    const context: GraphValidationContext = {
      agentSupportsModel: () => true,
      allowlistedSources: []
    }
    expect(
      validateWorkflowGraph(wf, context).filter(
        (p) => p.code === 'graph_model_override_not_supported'
      )
    ).toEqual([])
  })
})

describe('validateWorkflowGraph: skill source allowlist', () => {
  it('rejects a repository skill source that is not on the project allowlist', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('work'), endNode()],
      edges: [edge('e1', 'start', 'work'), edge('e2', 'work', 'end')],
      roles: {
        dev: role({
          skills: [
            {
              name: 'speckit',
              source: { kind: 'repository', location: 'https://example.com/not-allowed' },
              required: true
            }
          ]
        })
      }
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_skill_source_not_allowlisted',
        roleId: 'dev',
        severity: 'error'
      })
    )
  })

  it('accepts a repository skill source that is on the project allowlist', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('work'), endNode()],
      edges: [edge('e1', 'start', 'work'), edge('e2', 'work', 'end')],
      roles: {
        dev: role({
          skills: [
            {
              name: 'speckit',
              source: { kind: 'repository', location: 'https://example.com/allowed' },
              required: true
            }
          ]
        })
      }
    })
    const context: GraphValidationContext = {
      agentSupportsModel: () => true,
      allowlistedSources: ['https://example.com/allowed']
    }
    expect(
      validateWorkflowGraph(wf, context).filter(
        (p) => p.code === 'graph_skill_source_not_allowlisted'
      )
    ).toEqual([])
  })
})

describe('validateWorkflowGraph: known agents', () => {
  it('reports an unknown agent when the host injects isKnownAgent', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('work'), endNode()],
      edges: [edge('e1', 'start', 'work'), edge('e2', 'work', 'end')],
      roles: { dev: role({ agent: 'made-up-agent' }) }
    })
    const context: GraphValidationContext = {
      agentSupportsModel: () => true,
      allowlistedSources: [],
      isKnownAgent: (agent) => agent === 'claude'
    }
    expect(validateWorkflowGraph(wf, context)).toContainEqual(
      expect.objectContaining({ code: 'graph_unknown_agent', roleId: 'dev', severity: 'error' })
    )
  })

  it('skips the unknown-agent check when isKnownAgent is not provided', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('work'), endNode()],
      edges: [edge('e1', 'start', 'work'), edge('e2', 'work', 'end')],
      roles: { dev: role({ agent: 'made-up-agent' }) }
    })
    expect(
      validateWorkflowGraph(wf, permissiveContext).filter((p) => p.code === 'graph_unknown_agent')
    ).toEqual([])
  })
})

describe('validateWorkflowGraph: workspace policy', () => {
  it('rejects a child workspace when workspacePolicy is in-place', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('work', { workspace: 'child' }), endNode()],
      edges: [edge('e1', 'start', 'work'), edge('e2', 'work', 'end')],
      workspacePolicy: 'in-place'
    })
    expect(validateWorkflowGraph(wf, permissiveContext)).toContainEqual(
      expect.objectContaining({
        code: 'graph_child_workspace_disallowed',
        nodeId: 'work',
        severity: 'error'
      })
    )
  })

  it('accepts a child workspace when workspacePolicy is run-workspace', () => {
    const wf = workflow({
      nodes: [startNode(), agentNode('work', { workspace: 'child' }), endNode()],
      edges: [edge('e1', 'start', 'work'), edge('e2', 'work', 'end')],
      workspacePolicy: 'run-workspace'
    })
    expect(
      validateWorkflowGraph(wf, permissiveContext).filter(
        (p) => p.code === 'graph_child_workspace_disallowed'
      )
    ).toEqual([])
  })
})

describe('validateWorkflowGraph: fixtures', () => {
  it.each(['feature-with-qa.workflow.yaml', 'two-node.workflow.yaml'])(
    'validates %s with no problems',
    (fileName) => {
      const raw = parseYaml(readFileSync(resolve(FIXTURES_DIR, fileName), 'utf8'))
      const { definition, problems: parseProblems } = parseWorkflowDefinition(raw)
      expect(parseProblems).toEqual([])
      if (!definition) {
        throw new Error(`fixture ${fileName} failed to parse`)
      }
      const context: GraphValidationContext = {
        agentSupportsModel: () => true,
        allowlistedSources: ['https://github.com/github/spec-kit']
      }
      expect(validateWorkflowGraph(definition, context)).toEqual([])
    }
  )
})
