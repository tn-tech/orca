import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  markKimiWorkspaceTrusted: vi.fn(),
  markRemoteAgentWorkspaceTrusted: vi.fn()
}))

vi.mock('../kimi/kimi-workspace-trust', () => ({
  markKimiWorkspaceTrusted: mocks.markKimiWorkspaceTrusted
}))

vi.mock('../remote-agent-trust-presets', () => ({
  markRemoteAgentWorkspaceTrusted: mocks.markRemoteAgentWorkspaceTrusted
}))

vi.mock('../agent-trust-presets', () => ({
  markAntigravityWorkspaceTrusted: vi.fn(),
  markCodexProjectTrusted: vi.fn(),
  markCopilotFolderTrusted: vi.fn(),
  markCursorWorkspaceTrusted: vi.fn()
}))

import {
  markLocalWorktreeTrusted,
  markRemoteWorktreeTrusted
} from './runtime-worktree-agent-startup'

// Why: workflow and orchestration workers launch through createTerminal(startupAgent), whose only
// trust write is this chain — without a Kimi branch every Kimi worker stalls on "Trust this folder?".
describe('Kimi workspace pre-trust on the runtime launch path', () => {
  it('waits for the local Kimi trust write before resolving', async () => {
    let finish!: () => void
    mocks.markKimiWorkspaceTrusted.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    let settled = false
    const marking = markLocalWorktreeTrusted('kimi', '/workspace/app').then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    finish()
    await marking
    expect(mocks.markKimiWorkspaceTrusted).toHaveBeenCalledWith('/workspace/app')
  })

  it('contains a rejected local Kimi trust write', async () => {
    mocks.markKimiWorkspaceTrusted.mockRejectedValueOnce(new Error('write failed'))

    await expect(markLocalWorktreeTrusted('kimi', '/workspace/app')).resolves.toBeUndefined()
  })

  it('routes an SSH Kimi workspace to the remote kimi preset', async () => {
    await markRemoteWorktreeTrusted('kimi', 'ssh-1', '/repo/wt')

    expect(mocks.markRemoteAgentWorkspaceTrusted).toHaveBeenCalledWith({
      preset: 'kimi',
      connectionId: 'ssh-1',
      workspacePath: '/repo/wt'
    })
  })
})
