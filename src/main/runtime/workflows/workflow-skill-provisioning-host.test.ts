import { describe, expect, it, vi } from 'vitest'
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'

vi.mock('../../../shared/child-process/run-process', () => ({ runProcess: vi.fn() }))

import { runProcess } from '../../../shared/child-process/run-process'
import { createRunSkillProvisioner } from './workflow-skill-provisioning-host'

const skill: SkillReference = {
  name: 'model-review',
  source: { kind: 'repository', location: 'https://github.com/acme/skills' },
  required: true
}

describe('createRunSkillProvisioner', () => {
  it('refuses an SSH workspace without installing anything locally', async () => {
    const provisioner = createRunSkillProvisioner({
      workspaceRoot: '/home/dev/repo',
      orcaIgnoreTarget: { host: 'remote', repoPath: '/home/dev/repo' }
    })

    const outcome = await provisioner.provision({
      runId: 'wfr_1',
      agent: 'claude',
      skills: [skill]
    })

    expect(outcome).toMatchObject({ kind: 'failed' })
    expect(outcome.kind === 'failed' && outcome.reason).toContain('nothing was installed')
    expect(runProcess).not.toHaveBeenCalled()
    await expect(provisioner.release('wfr_1')).resolves.toBeUndefined()
  })

  it('refuses a WSL workspace reached through a UNC path', async () => {
    const root = '\\\\wsl.localhost\\Ubuntu\\home\\dev\\repo'
    const provisioner = createRunSkillProvisioner({
      workspaceRoot: root,
      orcaIgnoreTarget: { host: 'local', repoPath: root }
    })

    const outcome = await provisioner.provision({
      runId: 'wfr_1',
      agent: 'claude',
      skills: [skill]
    })

    expect(outcome.kind).toBe('failed')
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('is a no-op for a node without skills on any host', async () => {
    const provisioner = createRunSkillProvisioner({
      workspaceRoot: '/home/dev/repo',
      orcaIgnoreTarget: { host: 'remote', repoPath: '/home/dev/repo' }
    })
    expect(await provisioner.provision({ runId: 'wfr_1', agent: 'claude', skills: [] })).toEqual({
      kind: 'ready',
      installed: []
    })
  })
})
