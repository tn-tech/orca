import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify } from 'yaml'
import { RoleFileSchema } from '../../../shared/workflows/workflow-definition-schema'
import type { Role } from '../../../shared/workflows/workflow-definition-types'
import type { RoleProposalChange } from '../../../shared/workflows/workflow-run-types'
import { gitExecFileAsync } from '../../git/runner'
import { buildRoleProposalBundle, unifiedFileDiff } from './workflow-role-proposal-bundle'
import { importedDeveloper } from './workflow-role-proposal-test-fixtures'

const role: Role = {
  ...importedDeveloper(),
  model: 'gpt-5',
  skills: [
    { name: 'lint', source: { kind: 'plugin', plugin: 'tools' }, required: true },
    { name: 'test', source: { kind: 'plugin', plugin: 'tools' }, required: false }
  ]
}

describe('role proposal bundle', () => {
  let origin: string

  beforeEach(async () => {
    origin = await mkdtemp(join(tmpdir(), 'role-origin-'))
    const { id: _id, origin: _origin, ...content } = role
    await mkdir(join(origin, 'roles'))
    await writeFile(join(origin, 'roles', 'developer.role.yaml'), stringify(content))
    await gitExecFileAsync(['init', '--quiet'], { cwd: origin })
  })

  afterEach(async () => {
    await rm(origin, { recursive: true, force: true })
  })

  async function applyToOrigin(change: RoleProposalChange): Promise<string> {
    const { patch } = buildRoleProposalBundle({
      workflowName: 'wf',
      runId: 'wfr_1',
      role,
      origin: role.origin ?? { source: '', version: '', importedAt: '', localModified: false },
      proposal: { roleId: 'developer', change, evidence: 'Seen in the run.' }
    })
    await writeFile(join(origin, 'change.patch'), patch)
    await gitExecFileAsync(['apply', 'change.patch'], { cwd: origin })
    return readFile(join(origin, 'roles', 'developer.role.yaml'), 'utf-8')
  }

  it('produces a patch git applies to the origin role file for a prompt change', async () => {
    const applied = await applyToOrigin({ systemPrompt: 'Implement it, then test it.' })
    expect(applied).toContain('systemPrompt: Implement it, then test it.')
    expect(applied).toContain('model: gpt-5')
  })

  it('produces a patch git applies for a skills change in the middle of the file', async () => {
    const applied = await applyToOrigin({
      skills: [{ name: 'lint', source: { kind: 'plugin', plugin: 'tools' }, required: true }]
    })
    expect(applied).not.toContain('name: test')
    expect(applied).toContain('name: lint')
  })

  it('fences the proposed file with more backticks than any run inside it', () => {
    const { readme } = buildRoleProposalBundle({
      workflowName: 'wf',
      runId: 'wfr_1',
      role,
      origin: role.origin ?? { source: '', version: '', importedAt: '', localModified: false },
      proposal: {
        roleId: 'developer',
        change: { systemPrompt: 'Quote code in ```` fences.' },
        evidence: 'Seen in the run.'
      }
    })
    const fences = readme.split('\n').filter((line) => /^`{3,}/.test(line))
    expect(fences).toEqual(['`````yaml', '`````'])
  })

  it('writes context lines around a single changed line', () => {
    const diff = unifiedFileDiff('f.txt', 'a\nb\nc\nd\ne\nf\ng\nh\n', 'a\nb\nc\nd\nX\nf\ng\nh\n')
    expect(diff.split('\n').slice(3)).toEqual([
      '@@ -2,7 +2,7 @@',
      ' b',
      ' c',
      ' d',
      '-e',
      '+X',
      ' f',
      ' g',
      ' h',
      ''
    ])
  })
})

describe("role proposal bundle against the origin's own file", () => {
  let origin: string

  beforeEach(async () => {
    origin = await mkdtemp(join(tmpdir(), 'role-origin-text-'))
    await mkdir(join(origin, 'roles'))
    await gitExecFileAsync(['init', '--quiet'], { cwd: origin })
  })

  afterEach(async () => {
    await rm(origin, { recursive: true, force: true })
  })

  /** Exports `change` against `text` as the origin file, applies it with git, returns the patch. */
  async function exportAndApply(text: string, change: RoleProposalChange) {
    const file = join(origin, 'roles', 'developer.role.yaml')
    await writeFile(file, text)
    const { patch, readme } = buildRoleProposalBundle({
      workflowName: 'wf',
      runId: 'wfr_1',
      role,
      origin: role.origin ?? { source: '', version: '', importedAt: '', localModified: false },
      proposal: { roleId: 'developer', change, evidence: 'Seen in the run.' },
      originText: { text, version: 'feedface00' }
    })
    await writeFile(join(origin, 'change.patch'), patch)
    await gitExecFileAsync(['apply', 'change.patch'], { cwd: origin })
    return { patch, readme, applied: await readFile(file, 'utf-8') }
  }

  const changedLines = (patch: string) =>
    patch.split('\n').filter((line) => /^[-+](?![-+]{2} [ab]\/)/.test(line))

  it('leaves an unchanged long single-line field alone on a skills-only change', async () => {
    const longPrompt = `Implement it. ${'Keep every change small and covered by a test. '.repeat(4).trim()}`
    const text = [
      'name: Developer',
      'agent: codex',
      `systemPrompt: ${longPrompt}`,
      'skills:',
      '  - name: lint',
      '    source: { kind: plugin, plugin: tools }',
      ''
    ].join('\n')
    const { patch, applied, readme } = await exportAndApply(text, {
      skills: [{ name: 'test', source: { kind: 'plugin', plugin: 'tools' }, required: true }]
    })
    expect(changedLines(patch).every((line) => !line.includes('systemPrompt'))).toBe(true)
    expect(changedLines(patch).every((line) => /^[-+]\s/.test(line))).toBe(true)
    expect(applied).toContain(`systemPrompt: ${longPrompt}\n`)
    expect(readme).toContain('as it is at feedface00')
  })

  const multiLinePrompt = [
    'Implement it.',
    '',
    'Say "done" only after `pnpm test` passes; don\'t skip ```fenced``` checks.',
    '',
    '  Indented: keep it.'
  ].join('\n')

  it.each([
    ['block literal', 'systemPrompt: |\n  Implement it.\n  Carefully.\n'],
    ['double-quoted', 'systemPrompt: "Implement it."\n'],
    ['single-quoted', "systemPrompt: 'Implement it.'\n"]
  ])(
    'round-trips every field of the proposed role against a %s origin prompt',
    async (_style, prompt) => {
      const text = `# Developer\nname: Developer\nagent: codex\nmodel: gpt-5\n${prompt}skills: []\n`
      const skills = [
        { name: 'lint', source: { kind: 'plugin' as const, plugin: 'tools' }, required: true }
      ]
      const { applied } = await exportAndApply(text, { systemPrompt: multiLinePrompt, skills })
      const parsed = RoleFileSchema.parse(parseYaml(applied))
      expect(parsed).toEqual({
        name: 'Developer',
        agent: 'codex',
        model: 'gpt-5',
        systemPrompt: multiLinePrompt,
        skills
      })
      expect(applied.startsWith('# Developer\n')).toBe(true)
    }
  )
})
