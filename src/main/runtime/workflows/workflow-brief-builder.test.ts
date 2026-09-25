import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertWorkerStartTaskSpecWithinPromptBudget } from '../rpc/methods/orchestration/worker/worker-start-prompt-budget'
import type {
  AgentNode,
  ReflectionNode,
  RouterNode
} from '../../../shared/workflows/workflow-definition-types'
import { localWorkflowFilesystem } from './workflow-file-store-filesystem'
import {
  buildBriefMarkdown,
  buildInputsJson,
  buildTaskSpec,
  writeBrief
} from './workflow-brief-builder'

const agentNode: AgentNode = {
  id: 'implement',
  type: 'agent',
  title: 'Implement',
  prompt: 'Implement: ${objective}. Prior findings: ${upstream.plan.result.summary}',
  workspace: 'run',
  resultContract: {
    type: 'object',
    required: ['summary'],
    properties: { summary: { type: 'string' } }
  },
  artifacts: [{ path: 'src/**/*.ts', required: true }],
  question: { timeoutMs: 1000, escalationGraceMs: 1000 }
}

const routerNode: RouterNode = {
  id: 'route',
  type: 'router',
  title: 'Route',
  prompt: 'Choose a path for ${objective}.',
  choices: ['fast', 'slow']
}

const reflectionNode: ReflectionNode = {
  id: 'reflect',
  type: 'reflection',
  title: 'Reflect',
  prompt: 'Reflect on ${objective}.'
}

const role = {
  systemPrompt: 'You implement exactly what the objective describes.',
  skills: [
    {
      name: 'speckit-plan',
      source: { kind: 'repository' as const, location: 'https://github.com/github/spec-kit' },
      required: true
    },
    {
      name: 'superpowers',
      source: { kind: 'plugin' as const, plugin: 'superpowers' },
      required: true
    }
  ]
}

const briefInputs = {
  objective: 'Add CSV export to the reports page',
  upstream: {
    plan: { result: { summary: 'Plan drafted' }, artifacts: ['specs/plan.md'] }
  }
}

describe('buildBriefMarkdown', () => {
  it('contains the seven contract sections in order with references resolved', () => {
    const { text, problems } = buildBriefMarkdown({
      workflowName: 'feature-with-qa',
      runId: 'run-1',
      attemptId: 'attempt-1',
      node: agentNode,
      systemPrompt: role.systemPrompt,
      skills: role.skills,
      briefInputs
    })
    expect(problems).toEqual([])
    const sections = ['Role', 'Task', 'Inputs', 'Skills', 'Result', 'Artifacts', 'Completion']
    const indices = sections.map((heading) => text.indexOf(`## ${heading}`))
    for (const index of indices) {
      expect(index).toBeGreaterThanOrEqual(0)
    }
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
    expect(text).toContain(
      'Implement: Add CSV export to the reports page. Prior findings: Plan drafted'
    )
    expect(text).toContain(role.systemPrompt)
    expect(text).toContain('/speckit-plan')
    expect(text).toContain('/superpowers')
    expect(text).toContain('.orca/workflow-runs/run-1/attempt-1/inputs.json')
    expect(text).toContain('.orca/workflow-runs/run-1/attempt-1/result.json')
    expect(text).toContain('src/**/*.ts')
    expect(text).toContain('worker_done')
  })

  it('reports unresolved reference problems from the Task section', () => {
    const { problems } = buildBriefMarkdown({
      workflowName: 'wf',
      runId: 'run-1',
      attemptId: 'attempt-1',
      node: { ...agentNode, prompt: 'Missing: ${upstream.missing.result.x}' },
      systemPrompt: role.systemPrompt,
      skills: [],
      briefInputs
    })
    expect(problems).toHaveLength(1)
    expect(problems[0].code).toBe('workflow_brief_reference_unresolved')
  })

  it('renders the router canonical result contract', () => {
    const { text } = buildBriefMarkdown({
      workflowName: 'wf',
      runId: 'run-1',
      attemptId: 'attempt-1',
      node: routerNode,
      systemPrompt: role.systemPrompt,
      skills: [],
      briefInputs
    })
    expect(text).toContain('"choice"')
    expect(text).toContain('"reason"')
    expect(text).toContain('fast')
  })

  it('renders the reflection canonical result contract', () => {
    const { text } = buildBriefMarkdown({
      workflowName: 'wf',
      runId: 'run-1',
      attemptId: 'attempt-1',
      node: reflectionNode,
      systemPrompt: role.systemPrompt,
      skills: [],
      briefInputs
    })
    expect(text).toContain('"proposals"')
    expect(text).toContain('"roleId"')
  })

  it('notes when a role has no skills', () => {
    const { text } = buildBriefMarkdown({
      workflowName: 'wf',
      runId: 'run-1',
      attemptId: 'attempt-1',
      node: agentNode,
      systemPrompt: role.systemPrompt,
      skills: [],
      briefInputs
    })
    expect(text).toContain('No skills configured')
  })
})

describe('buildInputsJson', () => {
  it('includes nodeId and iteration for the stub agent, plus the reference data', () => {
    const inputs = buildInputsJson({
      nodeId: 'implement',
      iteration: 2,
      objective: briefInputs.objective,
      upstream: briefInputs.upstream,
      loopPrevious: { review: { result: { approved: false } } },
      joinBranches: { plan: 'completed' }
    })
    expect(inputs).toMatchObject({
      nodeId: 'implement',
      iteration: 2,
      objective: briefInputs.objective,
      upstream: briefInputs.upstream,
      loopPrevious: { review: { result: { approved: false } } },
      joinBranches: { plan: 'completed' }
    })
  })

  it('omits loopPrevious and joinBranches when not provided', () => {
    const inputs = buildInputsJson({
      nodeId: 'implement',
      iteration: 1,
      objective: briefInputs.objective,
      upstream: briefInputs.upstream
    })
    expect(inputs).not.toHaveProperty('loopPrevious')
    expect(inputs).not.toHaveProperty('joinBranches')
  })
})

describe('buildTaskSpec', () => {
  it('is the three-line pointer and stays within the worker-start prompt budget', async () => {
    const spec = buildTaskSpec({
      workflowName: 'feature-with-qa',
      runId: 'run-1',
      attemptId: 'attempt-1',
      nodeTitle: 'Implement'
    })
    const lines = spec.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(
      'Workflow "feature-with-qa" run run-1, node "Implement" (attempt attempt-1).'
    )
    expect(lines[1]).toBe(
      'Read and follow .orca/workflow-runs/run-1/attempt-1/brief.md before doing anything else.'
    )
    expect(lines[2]).toBe(
      'Write your result to .orca/workflow-runs/run-1/attempt-1/result.json and pass it as --report-path on worker_done.'
    )
    await expect(assertWorkerStartTaskSpecWithinPromptBudget(spec)).resolves.toBeUndefined()
  })
})

describe('writeBrief', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-brief-builder-'))
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it('writes brief.md and inputs.json under .orca/workflow-runs/<runId>/<attemptId>/ and git-ignores .orca', async () => {
    const result = await writeBrief({
      fs: localWorkflowFilesystem,
      workspaceRoot,
      orcaIgnoreTarget: { host: 'local', repoPath: workspaceRoot },
      workflowName: 'feature-with-qa',
      runId: 'run-1',
      attemptId: 'attempt-1',
      node: agentNode,
      systemPrompt: role.systemPrompt,
      skills: role.skills,
      iteration: 1,
      briefInputs
    })

    expect(result.briefPath).toBe('.orca/workflow-runs/run-1/attempt-1/brief.md')
    expect(result.resultPath).toBe('.orca/workflow-runs/run-1/attempt-1/result.json')
    expect(result.problems).toEqual([])

    const briefText = await readFile(join(workspaceRoot, result.briefPath), 'utf-8')
    expect(briefText).toContain('## Role')
    expect(briefText).toContain(role.systemPrompt)

    const inputsJsonRaw = await readFile(
      join(workspaceRoot, '.orca/workflow-runs/run-1/attempt-1/inputs.json'),
      'utf-8'
    )
    const inputsJson: unknown = JSON.parse(inputsJsonRaw)
    expect(inputsJson).toMatchObject({ nodeId: 'implement', iteration: 1 })

    const gitignore = await readFile(join(workspaceRoot, '.gitignore'), 'utf-8')
    expect(gitignore).toMatch(/^\.orca\/?$/m)

    const lines = result.taskSpec.split('\n')
    expect(lines).toHaveLength(3)
    expect(result.taskSpec).toContain('.orca/workflow-runs/run-1/attempt-1/brief.md')
  })

  it('appends to an existing .gitignore without a trailing blank line', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(workspaceRoot, '.gitignore'), 'node_modules\n', 'utf-8')

    await writeBrief({
      fs: localWorkflowFilesystem,
      workspaceRoot,
      orcaIgnoreTarget: { host: 'local', repoPath: workspaceRoot },
      workflowName: 'wf',
      runId: 'run-2',
      attemptId: 'attempt-1',
      node: agentNode,
      systemPrompt: role.systemPrompt,
      skills: [],
      iteration: 1,
      briefInputs
    })

    const gitignore = await readFile(join(workspaceRoot, '.gitignore'), 'utf-8')
    expect(gitignore).toBe('node_modules\n.orca\n')
  })
})
