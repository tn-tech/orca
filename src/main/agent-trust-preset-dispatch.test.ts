import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cursor: vi.fn(),
  copilot: vi.fn(),
  codex: vi.fn(),
  antigravity: vi.fn(),
  kimi: vi.fn()
}))

vi.mock('./agent-trust-presets', () => ({
  markCursorWorkspaceTrusted: mocks.cursor,
  markCopilotFolderTrusted: mocks.copilot,
  markCodexProjectTrusted: mocks.codex,
  markAntigravityWorkspaceTrusted: mocks.antigravity
}))

vi.mock('./kimi/kimi-workspace-trust', () => ({
  markKimiWorkspaceTrusted: mocks.kimi
}))

const { markLocalAgentWorkspaceTrusted } = await import('./agent-trust-preset-dispatch')

describe('markLocalAgentWorkspaceTrusted', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['cursor', 'copilot', 'codex', 'antigravity', 'kimi'] as const)(
    'routes the %s preset to its own trust writer only',
    async (preset) => {
      await markLocalAgentWorkspaceTrusted(preset, '/workspace/app')

      for (const [name, writer] of Object.entries(mocks)) {
        if (name === preset) {
          expect(writer).toHaveBeenCalledWith('/workspace/app')
        } else {
          expect(writer).not.toHaveBeenCalled()
        }
      }
    }
  )

  it('waits for an async trust write before resolving', async () => {
    let finish!: () => void
    mocks.codex.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)))
    let settled = false
    const marking = markLocalAgentWorkspaceTrusted('codex', '/w').then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    finish()
    await marking
    expect(settled).toBe(true)
  })
})
