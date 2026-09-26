import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { provisionNodeSkills, releaseRunSkillInstalls } from './workflow-skill-provisioning'
import {
  createSkillPorts,
  fakeSkillsCli,
  skillInput
} from './workflow-skill-provisioning-test-fixtures'

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'orca-skill-install-'))
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

const skillDir = () => join(workspaceRoot, '.claude/skills/model-review')
const lockFile = () => join(workspaceRoot, 'skills-lock.json')

describe('repository skill install — version control safety (FR-021)', () => {
  it('refuses when git already tracks a path the CLI would write, without running it', async () => {
    const { ports } = createSkillPorts(workspaceRoot, null, {
      listTrackedPaths: vi.fn(async () => ['skills-lock.json'])
    })

    const outcome = await provisionNodeSkills(skillInput(workspaceRoot), ports)

    expect(outcome).toMatchObject({ kind: 'failed' })
    expect(outcome.kind === 'failed' && outcome.reason).toContain('skills-lock.json')
    expect(outcome.kind === 'failed' && outcome.reason).toContain('version control')
    expect(ports.runProcess).not.toHaveBeenCalled()
    expect(ports.listTrackedPaths).toHaveBeenCalledWith(workspaceRoot, [
      '.agents/skills/model-review',
      '.claude/skills/model-review',
      'skills-lock.json'
    ])
  })

  it("restores an untracked user file the CLI modified once the run's cleanup runs", async () => {
    await writeFile(lockFile(), '{"user":true}')
    const { ports } = createSkillPorts(workspaceRoot, null)

    await provisionNodeSkills(skillInput(workspaceRoot), ports)
    expect(await readFile(lockFile(), 'utf-8')).toBe('{"cli":"model-review"}')

    await releaseRunSkillInstalls({ runId: 'wfr_1', workspaceRoot }, ports)
    expect(await readFile(lockFile(), 'utf-8')).toBe('{"user":true}')
    expect(existsSync(skillDir())).toBe(false)
  })

  it('removes a partial install and restores snapshots when `skills add` fails', async () => {
    await writeFile(lockFile(), '{"user":true}')
    const { ports } = createSkillPorts(workspaceRoot, null, {
      runProcess: fakeSkillsCli(workspaceRoot, { code: null, timedOut: true, partial: true })
    })

    const outcome = await provisionNodeSkills(skillInput(workspaceRoot), ports)

    expect(outcome.kind === 'failed' && outcome.reason).toContain('timed out')
    expect(existsSync(skillDir())).toBe(false)
    expect(existsSync(join(workspaceRoot, '.agents/skills/model-review'))).toBe(false)
    expect(await readFile(lockFile(), 'utf-8')).toBe('{"user":true}')
  })
})

describe('repository skill install — shared workspaces', () => {
  it('keeps a skill run A installed until run B, which reuses it, is released too', async () => {
    const { ports } = createSkillPorts(workspaceRoot, null)
    await provisionNodeSkills(skillInput(workspaceRoot, { runId: 'wfr_a' }), ports)
    expect(await provisionNodeSkills(skillInput(workspaceRoot, { runId: 'wfr_b' }), ports)).toEqual(
      { kind: 'ready', installed: [] }
    )
    expect(ports.runProcess).toHaveBeenCalledTimes(1)

    await releaseRunSkillInstalls({ runId: 'wfr_a', workspaceRoot }, ports)
    expect(existsSync(skillDir())).toBe(true)
    expect(existsSync(lockFile())).toBe(true)

    await releaseRunSkillInstalls({ runId: 'wfr_b', workspaceRoot }, ports)
    expect(existsSync(skillDir())).toBe(false)
    expect(existsSync(lockFile())).toBe(false)
  })

  it("never deletes a user's own skill that a run found already present", async () => {
    await mkdir(skillDir(), { recursive: true })
    const { ports } = createSkillPorts(workspaceRoot, null)

    await provisionNodeSkills(skillInput(workspaceRoot), ports)
    await releaseRunSkillInstalls({ runId: 'wfr_1', workspaceRoot }, ports)

    expect(existsSync(skillDir())).toBe(true)
  })

  it('never lets a tampered ledger delete outside the workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'orca-skill-outside-'))
    const ledger = join(workspaceRoot, '.orca/workflow-skills/ledger.json')
    await mkdir(join(ledger, '..'), { recursive: true })
    const escape = `../${outside.split(/[\\/]/).pop()}`
    await writeFile(
      ledger,
      JSON.stringify({
        [escape]: { origin: 'created', runs: ['wfr_1'] },
        [outside]: { origin: 'created', runs: ['wfr_1'] }
      })
    )
    const { ports } = createSkillPorts(workspaceRoot, null)

    await releaseRunSkillInstalls({ runId: 'wfr_1', workspaceRoot }, ports)

    expect(existsSync(outside)).toBe(true)
    await rm(outside, { recursive: true, force: true })
  })
})
