import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getActiveMultiplexer: vi.fn(),
  getSshFilesystemProvider: vi.fn()
}))

vi.mock('./ssh/ssh-target-registry', () => ({
  getActiveMultiplexer: mocks.getActiveMultiplexer
}))

vi.mock('./providers/ssh-filesystem-dispatch', () => ({
  getSshFilesystemProvider: mocks.getSshFilesystemProvider
}))

const { markRemoteAgentWorkspaceTrusted } = await import('./remote-agent-trust-presets')

function makeFsProvider(overrides: Record<string, unknown> = {}) {
  return {
    realpath: vi.fn(async (path: string) => `/real${path}`),
    readFile: vi.fn(async () => ({ content: '', isBinary: false })),
    createDir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (_path: string, _content: string) => undefined),
    rename: vi.fn(async (_from: string, _to: string) => undefined),
    deletePath: vi.fn(async () => undefined),
    // The Kimi home exists; the trust record does not.
    stat: vi.fn(async (path: string) => {
      if (path === '/home/u/.kimi-code') {
        return { type: 'directory' }
      }
      throw new Error('missing')
    }),
    ...overrides
  }
}

describe('markRemoteAgentWorkspaceTrusted (kimi)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getActiveMultiplexer.mockReturnValue({
      request: vi.fn(async () => ({ resolvedPath: '/home/u/' }))
    })
  })

  it('writes the Kimi trust record into the remote home, keyed by the remote realpath', async () => {
    const fsProvider = makeFsProvider()
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'kimi',
      connectionId: 'ssh-1',
      workspacePath: '/repo/worktree'
    })

    const recordPath = '/home/u/.kimi-code/workspace-trust/wd_worktree_c5e24ddfd935'
    expect(fsProvider.createDir).toHaveBeenCalledWith('/home/u/.kimi-code/workspace-trust')
    expect(fsProvider.writeFile).toHaveBeenCalledTimes(1)
    const [tempPath, content] = fsProvider.writeFile.mock.calls[0] ?? []
    // Why: atomic publish — Kimi must never read a half-written record.
    expect(tempPath).not.toBe(recordPath)
    expect(tempPath?.startsWith('/home/u/.kimi-code/workspace-trust/')).toBe(true)
    expect(fsProvider.rename).toHaveBeenCalledWith(tempPath, recordPath)
    expect(JSON.parse(content ?? '')).toEqual({
      root: '/real/repo/worktree',
      trustedAt: expect.any(Number)
    })
  })

  it('leaves an existing remote Kimi trust record untouched', async () => {
    const fsProvider = makeFsProvider({ stat: vi.fn(async () => ({ type: 'file' })) })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'kimi',
      connectionId: 'ssh-1',
      workspacePath: '/repo/worktree'
    })

    expect(fsProvider.stat).toHaveBeenCalledWith(
      '/home/u/.kimi-code/workspace-trust/wd_worktree_c5e24ddfd935'
    )
    expect(fsProvider.writeFile).not.toHaveBeenCalled()
  })

  it('does not create a Kimi home on a host where Kimi never ran', async () => {
    const fsProvider = makeFsProvider({
      stat: vi.fn(async () => {
        throw new Error('missing')
      })
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'kimi',
      connectionId: 'ssh-1',
      workspacePath: '/repo/worktree'
    })

    expect(fsProvider.createDir).not.toHaveBeenCalled()
    expect(fsProvider.writeFile).not.toHaveBeenCalled()
  })

  it('removes the temp file when the publish rename fails', async () => {
    const fsProvider = makeFsProvider({
      rename: vi.fn(async () => {
        throw new Error('rename failed')
      })
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await expect(
      markRemoteAgentWorkspaceTrusted({
        preset: 'kimi',
        connectionId: 'ssh-1',
        workspacePath: '/repo/worktree'
      })
    ).rejects.toThrow('rename failed')

    const [tempPath] = fsProvider.writeFile.mock.calls[0] ?? []
    expect(fsProvider.deletePath).toHaveBeenCalledWith(tempPath)
  })
})
