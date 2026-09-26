import { describe, expect, it, vi } from 'vitest'
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'

vi.mock('../../../shared/child-process/run-process', () => ({ runProcess: vi.fn() }))
vi.mock('./workflow-source-allowlist', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRepoWorkflowSourceAllowlist: vi.fn(async () => ['https://github.com/acme/skills'])
}))

import { runProcess } from '../../../shared/child-process/run-process'
import { createRunSkillProvisioner } from './workflow-skill-provisioning-host'

const skill: SkillReference = {
  name: 'model-review',
  source: { kind: 'repository', location: 'https://github.com/acme/skills' },
  required: true
}

describe('createRunSkillProvisioner', () => {
  it('refuses an SSH workspace whose host is not connected without installing anything locally', async () => {
    const provisioner = createRunSkillProvisioner({
      workspaceRoot: '/home/dev/repo',
      orcaIgnoreTarget: { host: 'remote', repoPath: '/home/dev/repo', connectionId: 'conn-gone' }
    })

    const outcome = await provisioner.provision({
      runId: 'wfr_1',
      agent: 'claude',
      skills: [skill]
    })

    expect(outcome).toMatchObject({ kind: 'failed', code: 'workflow_host_unreachable' })
    expect(outcome.kind === 'failed' && outcome.reason).toContain('nothing was installed')
    expect(runProcess).not.toHaveBeenCalled()
    await expect(provisioner.release('wfr_1')).resolves.toBeUndefined()
  })

  it('never runs a local process other than wsl.exe for a WSL workspace', async () => {
    const root = '\\\\wsl.localhost\\Ubuntu\\home\\dev\\repo'
    vi.mocked(runProcess).mockResolvedValue({
      code: 1,
      signal: null,
      stdout: '',
      stderr: 'There is no distribution with the supplied name.',
      timedOut: false
    })
    const provisioner = createRunSkillProvisioner({
      workspaceRoot: root,
      orcaIgnoreTarget: { host: 'local', repoPath: root }
    })

    await expect(
      provisioner.provision({ runId: 'wfr_1', agent: 'claude', skills: [skill] })
    ).rejects.toThrow('no distribution')
    expect(vi.mocked(runProcess).mock.calls.length).toBeGreaterThan(0)
    for (const [spec] of vi.mocked(runProcess).mock.calls) {
      expect(spec.program).toMatch(/wsl(\.exe)?$/i)
      expect(spec.args?.slice(0, 3)).toEqual(['-d', 'Ubuntu', '--exec'])
    }
  })

  it('is a no-op for a node without skills on any host', async () => {
    const provisioner = createRunSkillProvisioner({
      workspaceRoot: '/home/dev/repo',
      orcaIgnoreTarget: { host: 'remote', repoPath: '/home/dev/repo', connectionId: 'conn-gone' }
    })
    expect(await provisioner.provision({ runId: 'wfr_1', agent: 'claude', skills: [] })).toEqual({
      kind: 'ready',
      installed: []
    })
  })
})
