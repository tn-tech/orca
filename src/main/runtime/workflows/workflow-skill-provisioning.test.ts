import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'
import {
  provisionNodeSkills,
  releaseRunSkillInstalls,
  type ProvisionNodeSkillsInput
} from './workflow-skill-provisioning'
import {
  createSkillPorts,
  fakeSkillsCli,
  REPO_SOURCE,
  repoSkill,
  skillInput
} from './workflow-skill-provisioning-test-fixtures'

const pluginSkill: SkillReference = {
  name: 'deck-writer',
  source: { kind: 'plugin', plugin: 'acme-decks' },
  required: true
}

let workspaceRoot: string
let excludePath: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'orca-skill-provisioning-'))
  excludePath = join(workspaceRoot, '.git', 'info', 'exclude')
  await mkdir(join(workspaceRoot, '.git', 'info'), { recursive: true })
  await writeFile(excludePath, '# user entry\n/scratch\n')
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

function createPorts(overrides: Parameters<typeof createSkillPorts>[2] = {}) {
  return createSkillPorts(workspaceRoot, excludePath, overrides)
}

function input(overrides: Partial<ProvisionNodeSkillsInput> = {}): ProvisionNodeSkillsInput {
  return skillInput(workspaceRoot, overrides)
}

describe('provisionNodeSkills — repository skills', () => {
  it('runs `skills add <location> --skill <name> --agent <provider> -y` in the run workspace', async () => {
    const { ports } = createPorts()
    const outcome = await provisionNodeSkills(input(), ports)

    expect(outcome).toEqual({ kind: 'ready', installed: ['model-review'] })
    expect(ports.runProcess).toHaveBeenCalledTimes(1)
    const spec = vi.mocked(ports.runProcess).mock.calls[0][0]
    expect(spec.program).toBe('/usr/local/bin/npx')
    expect(spec.cwd).toBe(workspaceRoot)
    expect(spec.args).toEqual([
      '--yes',
      'skills',
      'add',
      REPO_SOURCE,
      '--skill',
      'model-review',
      '--agent',
      'claude-code',
      '-y'
    ])
  })

  it('appends each installed path to .git/info/exclude and removes them on cleanup', async () => {
    const { ports } = createPorts()
    await provisionNodeSkills(input(), ports)

    const exclude = await readFile(excludePath, 'utf-8')
    expect(exclude).toContain('/scratch\n')
    expect(exclude).toContain('/.claude/skills/model-review\n')
    expect(exclude).toContain('/.agents/skills/model-review\n')
    expect(exclude).toContain('/skills-lock.json\n')
    expect(exclude).not.toMatch(/^\/\.claude\/skills$/m)

    await releaseRunSkillInstalls({ runId: 'wfr_1', workspaceRoot }, ports)

    expect(await readFile(excludePath, 'utf-8')).toBe('# user entry\n/scratch\n')
    expect(existsSync(join(workspaceRoot, '.claude/skills/model-review'))).toBe(false)
    expect(existsSync(join(workspaceRoot, 'skills-lock.json'))).toBe(false)
  })

  it('skips the install and the exclude entry when the skill is already in the workspace', async () => {
    await mkdir(join(workspaceRoot, '.claude/skills/model-review'), { recursive: true })
    const { ports } = createPorts()

    expect(await provisionNodeSkills(input(), ports)).toEqual({ kind: 'ready', installed: [] })
    expect(ports.runProcess).not.toHaveBeenCalled()
    expect(await readFile(excludePath, 'utf-8')).toBe('# user entry\n/scratch\n')
  })

  it('writes no exclude entry for a folder workspace without git', async () => {
    const { ports } = createPorts({ resolveGitExcludePath: async () => null })

    expect(await provisionNodeSkills(input(), ports)).toMatchObject({ kind: 'ready' })
    expect(await readFile(excludePath, 'utf-8')).toBe('# user entry\n/scratch\n')
  })

  it('fails with the CLI output when the install exits non-zero, before any launch', async () => {
    const { ports } = createPorts({
      runProcess: fakeSkillsCli(workspaceRoot, { code: 1, stderr: 'repository not found' })
    })

    const outcome = await provisionNodeSkills(input(), ports)
    expect(outcome).toMatchObject({ kind: 'failed' })
    expect(outcome.kind === 'failed' && outcome.reason).toContain('model-review')
    expect(outcome.kind === 'failed' && outcome.reason).toContain('repository not found')
  })

  it('refuses a source missing from the allowlist, naming the source and allowlist location', async () => {
    const { ports } = createPorts()
    const outcome = await provisionNodeSkills(
      input({ readAllowlist: async () => ({ sources: [], location: '/repo/orca.yaml' }) }),
      ports
    )

    expect(outcome).toMatchObject({
      kind: 'failed',
      code: 'workflow_source_not_allowed',
      allowlistPath: '/repo/orca.yaml'
    })
    expect(outcome.kind === 'failed' && outcome.reason).toContain(REPO_SOURCE)
    expect(ports.runProcess).not.toHaveBeenCalled()
  })
})

describe('provisionNodeSkills — plugin skills', () => {
  it('yields a trust question when the source has no trust decision on this host', async () => {
    const { ports, plugins } = createPorts({ trust: 'needs-question' })

    const outcome = await provisionNodeSkills(input({ skills: [pluginSkill, repoSkill] }), ports)

    expect(outcome).toEqual({
      kind: 'trust-required',
      question: { source: 'acme-decks', skills: ['deck-writer'], agents: ['claude'] }
    })
    expect(plugins.install).not.toHaveBeenCalled()
    expect(ports.runProcess).not.toHaveBeenCalled()
  })

  it('fails the node without installing when trust is refused', async () => {
    const { ports, plugins } = createPorts({ trust: 'refused' })

    const outcome = await provisionNodeSkills(input({ skills: [pluginSkill] }), ports)

    expect(outcome).toMatchObject({ kind: 'failed' })
    expect(outcome.kind === 'failed' && outcome.reason).toContain('acme-decks')
    expect(plugins.install).not.toHaveBeenCalled()
  })

  it('installs a trusted source through the provider plugin command', async () => {
    const { ports, plugins } = createPorts({ trust: 'trusted' })

    const outcome = await provisionNodeSkills(input({ skills: [pluginSkill] }), ports)

    expect(outcome).toEqual({ kind: 'ready', installed: ['deck-writer'] })
    expect(plugins.install).toHaveBeenCalledWith({ plugin: 'acme-decks', agent: 'claude' })
  })

  it('asks nothing when the plugin skill is already installed on the host', async () => {
    const { ports, plugins, trustGate } = createPorts()
    plugins.isInstalled.mockResolvedValue(true)

    expect(await provisionNodeSkills(input({ skills: [pluginSkill] }), ports)).toEqual({
      kind: 'ready',
      installed: []
    })
    expect(trustGate.decide).not.toHaveBeenCalled()
  })

  it('fails with the provider reason when the plugin install fails', async () => {
    const { ports, plugins } = createPorts({ trust: 'trusted' })
    plugins.install.mockResolvedValue({ ok: false, reason: 'aider has no plugin command' })

    const outcome = await provisionNodeSkills(input({ skills: [pluginSkill] }), ports)
    expect(outcome.kind === 'failed' && outcome.reason).toContain('aider has no plugin command')
  })
})

describe('provisionNodeSkills — prompt fallback', () => {
  it('returns the repository skills for the prompt when the agent has no workspace skill path', async () => {
    const { ports } = createPorts()

    const outcome = await provisionNodeSkills(input({ agent: 'aider' }), ports)

    expect(outcome).toEqual({
      kind: 'ready',
      installed: [],
      promptFallback: { agent: 'aider', skills: [repoSkill] }
    })
    expect(ports.runProcess).not.toHaveBeenCalled()
  })

  it('does nothing for a node without skills', async () => {
    const { ports } = createPorts()
    const readAllowlist = vi.fn()
    expect(await provisionNodeSkills(input({ skills: [], readAllowlist }), ports)).toEqual({
      kind: 'ready',
      installed: []
    })
    expect(readAllowlist).not.toHaveBeenCalled()
  })
})
