import { describe, expect, it } from 'vitest'
import { repoTrustHostKey } from './workflow-repo-trust-host'

describe('repoTrustHostKey', () => {
  it('defaults to local with no repo', () => {
    expect(repoTrustHostKey(null)).toBe('local')
  })

  it('is local for a repo with no SSH connection', () => {
    expect(repoTrustHostKey({ path: '/Users/dev/repo', connectionId: null })).toBe('local')
  })

  it('names the SSH target for a repo bound to one', () => {
    expect(repoTrustHostKey({ path: '/home/dev/repo', connectionId: 'devbox' })).toBe('ssh:devbox')
  })

  it('names the WSL distro for a repo living on a WSL UNC path', () => {
    expect(
      repoTrustHostKey({
        path: '\\\\wsl.localhost\\Ubuntu\\home\\dev\\repo',
        connectionId: null
      })
    ).toBe('wsl:ubuntu')
  })
})
