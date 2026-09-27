import { describe, expect, it } from 'vitest'
import { LOCAL_TRUST_HOST, workflowTrustHostKey } from './workflow-trust-host-key'

describe('workflowTrustHostKey', () => {
  it('names the host that executes the run workspace', () => {
    expect(
      workflowTrustHostKey({ workspaceRoot: '/repo', orcaIgnoreTarget: { host: 'local' } })
    ).toBe(LOCAL_TRUST_HOST)
    expect(
      workflowTrustHostKey({
        workspaceRoot: '/home/dev/repo',
        orcaIgnoreTarget: { host: 'remote', connectionId: 'devbox' }
      })
    ).toBe('ssh:devbox')
    expect(
      workflowTrustHostKey({
        workspaceRoot: '\\\\wsl.localhost\\Ubuntu\\home\\dev\\repo',
        orcaIgnoreTarget: { host: 'local' }
      })
    ).toBe('wsl:ubuntu')
    expect(
      workflowTrustHostKey({
        workspaceRoot: '\\\\wsl$\\UBUNTU\\home\\dev\\repo',
        orcaIgnoreTarget: { host: 'local' }
      })
    ).toBe('wsl:ubuntu')
  })
})
