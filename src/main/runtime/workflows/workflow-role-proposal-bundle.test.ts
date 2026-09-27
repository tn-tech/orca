import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
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
