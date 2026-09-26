import { posix } from 'node:path'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/run-process'
import {
  createWorkflowPluginPort,
  pluginInstallUnavailableReason,
  type PluginHostAccess
} from './workflow-plugin-install'

const HOME = '/home/dev'
const WORKSPACE = '/home/dev/repo'
const INSTALL_PATH = '/home/dev/.claude/plugins/cache/acme/acme-decks/1.0.0'

function installedPluginsJson(pluginId: string): string {
  return JSON.stringify({
    plugins: { [pluginId]: [{ scope: 'user', installPath: INSTALL_PATH }] }
  })
}

function fakeHost(options: {
  files?: Record<string, string>
  present?: string[]
  runCli?: (spec: ProcessSpec) => Promise<ProcessResult>
}): PluginHostAccess & { runCli: Mock<(spec: ProcessSpec) => Promise<ProcessResult>> } {
  const files = options.files ?? {}
  const present = new Set(options.present ?? [])
  return {
    runCli: vi.fn<(spec: ProcessSpec) => Promise<ProcessResult>>(
      options.runCli ??
        (async () => ({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false }))
    ),
    fs: {
      readText: async (path) => files[path] ?? null,
      exists: async (path) => present.has(path)
    },
    homeDir: async () => HOME,
    pathApi: posix,
    workspaceRoot: WORKSPACE
  }
}

function enabledHost(pluginId: string, enabled = true) {
  return fakeHost({
    files: {
      [`${HOME}/.claude/plugins/installed_plugins.json`]: installedPluginsJson(pluginId),
      [`${HOME}/.claude/settings.json`]: JSON.stringify({ enabledPlugins: { [pluginId]: enabled } })
    },
    present: [`${INSTALL_PATH}/skills/deck-writer`]
  })
}

describe('createWorkflowPluginPort — Claude Code presence (claude-plugin-skill-sources)', () => {
  it('finds an enabled plugin skill by bare name or by name@marketplace', async () => {
    const port = createWorkflowPluginPort(enabledHost('acme-decks@acme'))

    for (const plugin of ['acme-decks', 'acme-decks@acme']) {
      expect(await port.isInstalled({ plugin, skill: 'deck-writer', agent: 'claude' })).toBe(true)
    }
    expect(
      await port.isInstalled({ plugin: 'acme-decks@other', skill: 'deck-writer', agent: 'claude' })
    ).toBe(false)
  })

  it('does not count a disabled plugin or a skill the plugin lacks', async () => {
    const disabled = createWorkflowPluginPort(enabledHost('acme-decks@acme', false))
    const enabled = createWorkflowPluginPort(enabledHost('acme-decks@acme'))

    expect(
      await disabled.isInstalled({ plugin: 'acme-decks', skill: 'deck-writer', agent: 'claude' })
    ).toBe(false)
    expect(
      await enabled.isInstalled({ plugin: 'acme-decks', skill: 'other-skill', agent: 'claude' })
    ).toBe(false)
  })

  it('reports nothing installed for a verify-only provider', async () => {
    const port = createWorkflowPluginPort(enabledHost('acme-decks@acme'))
    expect(
      await port.isInstalled({ plugin: 'acme-decks', skill: 'deck-writer', agent: 'codex' })
    ).toBe(false)
  })
})

describe('createWorkflowPluginPort — install', () => {
  it('runs the verified Claude command on the host, in the workspace, without -y', async () => {
    const host = fakeHost({})
    const port = createWorkflowPluginPort(host)

    expect(await port.install({ plugin: 'acme-decks@acme', agent: 'claude' })).toEqual({
      ok: true
    })
    expect(host.runCli).toHaveBeenCalledTimes(1)
    const [spec] = host.runCli.mock.calls[0]
    expect(spec.program).toBe('claude')
    expect(spec.args).toEqual(['plugin', 'install', 'acme-decks@acme', '--scope', 'user'])
    expect(spec.cwd).toBe(WORKSPACE)
  })

  it('fails with the CLI output and manual instructions when the command fails', async () => {
    const port = createWorkflowPluginPort(
      fakeHost({
        runCli: async () => ({
          code: 1,
          signal: null,
          stdout: '',
          stderr: 'Plugin "acme-decks" not found in any marketplace',
          timedOut: false
        })
      })
    )

    const result = await port.install({ plugin: 'acme-decks', agent: 'claude' })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain('not found in any marketplace')
    expect(!result.ok && result.reason).toContain('Install plugin "acme-decks" on this host')
  })

  it('turns a missing CLI into a reason instead of throwing', async () => {
    const port = createWorkflowPluginPort(
      fakeHost({
        runCli: async () => {
          throw new Error('spawn claude ENOENT')
        }
      })
    )

    const result = await port.install({ plugin: 'acme-decks', agent: 'claude' })
    expect(!result.ok && result.reason).toContain('spawn claude ENOENT')
  })

  it('never runs anything for a verify-only provider and names the fix', async () => {
    const host = fakeHost({})
    const port = createWorkflowPluginPort(host)

    const result = await port.install({ plugin: 'acme-decks', agent: 'codex' })
    expect(result.ok).toBe(false)
    expect(host.runCli).not.toHaveBeenCalled()
    expect(port.unavailableReason({ plugin: 'acme-decks', agent: 'codex' })).toContain(
      'Install plugin "acme-decks"'
    )
    expect(pluginInstallUnavailableReason({ plugin: 'acme-decks', agent: 'claude' })).toBe(
      undefined
    )
  })

  it('treats an inherited object key as an unknown provider', () => {
    expect(pluginInstallUnavailableReason({ plugin: 'p', agent: 'toString' })).toBeDefined()
  })
})
