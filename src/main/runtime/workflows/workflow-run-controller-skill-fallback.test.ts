import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { RoleFetchHost } from './workflow-role-fetch-host'
import {
  createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

const SOURCE = 'https://github.com/acme/skills'
const repoFiles = new Map<string, string>()

// The repository the fallback reads SKILL.md from, standing in for a real clone.
const fakeFetchHost: RoleFetchHost = {
  createTempDir: async () => '/fetch/tmp',
  clone: async () => {},
  runGit: async () => [...repoFiles.keys()].map((path) => `${path}\0`).join(''),
  readFile: async (path) => repoFiles.get(path.replace('/fetch/tmp/repo/', '')) ?? '',
  removeDir: async () => {},
  joinPath: (dir, relative) => `${dir}/${relative}`
}

vi.mock('./workflow-role-fetch-host', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRoleFetchHost: () => fakeFetchHost
}))

/** `implement` runs on an agent with no workspace skill path and needs a repository skill. */
const FALLBACK_AGENT_WORKFLOW: Workflow = {
  ...TWO_NODE_WORKFLOW,
  roles: {
    ...TWO_NODE_WORKFLOW.roles,
    developer: {
      ...TWO_NODE_WORKFLOW.roles.developer,
      agent: 'aider',
      skills: [{ name: 'plan', source: { kind: 'repository', location: SOURCE }, required: true }]
    }
  }
}

describe('WorkflowRunController — prompt-fallback skills (FR-020)', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-controller-skill-fallback-'))
    await writeFile(
      join(workspaceRoot, 'orca.yaml'),
      `workflows:\n  allowedSources:\n    - ${SOURCE}\n`,
      'utf-8'
    )
    repoFiles.clear()
    h = createControllerHarness(workspaceRoot)
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    h.db.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  function implementAttempt(runId: string) {
    return h.db.listWorkflowAttempts(runId).find((attempt) => attempt.nodeId === 'implement')
  }

  it('fails the node before launch when the skill has no SKILL.md', async () => {
    repoFiles.set('skills/other/SKILL.md', '---\nname: other\ndescription: d\n---\nOther.')
    const run = h.createRun(FALLBACK_AGENT_WORKFLOW)
    const finished = h.createController(run.id).run()

    await waitUntil(() => h.db.getWorkflowRun(run.id)?.state === 'failed')
    await finished
    expect(implementAttempt(run.id)?.state).toBe('failed')
    expect(implementAttempt(run.id)?.failureReason).toContain('Skill "plan" has no SKILL.md')
    expect(h.workerHandles).toEqual([])
  })

  it('inlines the fetched SKILL.md in the brief and launches the worker', async () => {
    repoFiles.set('skills/plan/SKILL.md', '---\nname: plan\ndescription: d\n---\nPlan carefully.')
    const run = h.createRun(FALLBACK_AGENT_WORKFLOW)
    void h.createController(run.id).run()

    await waitUntil(() => h.workerHandles.length === 1)
    const briefPath = implementAttempt(run.id)?.briefPath ?? ''
    const brief = await readFile(join(workspaceRoot, briefPath), 'utf-8')
    const skills = brief.slice(brief.indexOf('## Skills'), brief.indexOf('## Result'))
    expect(skills).toContain(
      '```markdown\n---\nname: plan\ndescription: d\n---\nPlan carefully.\n```'
    )
    expect(skills).toContain(`\`skills/plan/SKILL.md\` from ${SOURCE}`)
  })
})
