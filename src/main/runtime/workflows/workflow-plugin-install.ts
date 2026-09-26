// Host-scope plugin skills (FR-018; research R9): a per-provider table built only from plugin
// commands verified on a real host (docs/reference/visual-dag-workflows.md, "Plugin provisioning
// evidence"). A provider without one is verify-only: its node fails with install instructions.
// Every check and install runs on the host that executes the node, through `PluginHostAccess`.
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/run-process'
import {
  getClaudePluginMetadataPaths,
  resolveClaudePluginInstallPaths,
  type SkillDiscoveryPathApi
} from '../../skills/claude-plugin-skill-sources'
import type {
  WorkflowPluginSkillPort,
  WorkflowSkillFilesystem
} from './workflow-skill-provisioning'

export type PluginHostAccess = {
  /** Runs `spec.program` from the executing host's own PATH. */
  runCli(spec: ProcessSpec): Promise<ProcessResult>
  fs: Pick<WorkflowSkillFilesystem, 'exists' | 'readText'>
  homeDir(): Promise<string>
  pathApi: SkillDiscoveryPathApi
  workspaceRoot: string
}

type PluginSkillRequest = { plugin: string; skill: string }

type PluginProvider = {
  isInstalled(host: PluginHostAccess, request: PluginSkillRequest): Promise<boolean>
  /** Only a verified non-interactive command belongs here. */
  installCommand: (plugin: string) => { program: string; args: string[] }
}

// Why generous: a first install may clone a marketplace before it fetches the plugin.
const PLUGIN_INSTALL_TIMEOUT_MS = 5 * 60_000
const MAX_REASON_OUTPUT_CHARS = 600

/** `name` matches any marketplace's `name@<marketplace>`; `name@marketplace` matches exactly. */
function matchesPluginId(pluginId: string, plugin: string): boolean {
  return plugin.includes('@') ? pluginId === plugin : pluginId.split('@')[0] === plugin
}

async function claudePluginSkillInstalled(
  host: PluginHostAccess,
  { plugin, skill }: PluginSkillRequest
): Promise<boolean> {
  const paths = getClaudePluginMetadataPaths(await host.homeDir(), host.workspaceRoot, host.pathApi)
  const [installedPlugins, ...settings] = await Promise.all(
    [paths.installedPlugins, ...paths.settings].map((path) => host.fs.readText(path))
  )
  const installs = resolveClaudePluginInstallPaths({
    metadata: { installedPlugins, settings },
    cwd: host.workspaceRoot,
    pathApi: host.pathApi
  })
  for (const [pluginId, installPath] of installs) {
    if (
      matchesPluginId(pluginId, plugin) &&
      (await host.fs.exists(host.pathApi.join(installPath, 'skills', skill)))
    ) {
      return true
    }
  }
  return false
}

const PLUGIN_PROVIDERS: Readonly<Record<string, PluginProvider>> = {
  // `-y` is withheld on purpose: trusting a source is not consent to a marketplace-declared command.
  claude: {
    isInstalled: claudePluginSkillInstalled,
    installCommand: (plugin) => ({
      program: 'claude',
      args: ['plugin', 'install', plugin, '--scope', 'user']
    })
  }
}

function pluginProvider(agent: string): PluginProvider | undefined {
  return Object.hasOwn(PLUGIN_PROVIDERS, agent) ? PLUGIN_PROVIDERS[agent] : undefined
}

/** Instructions for a provider Orca cannot install plugins for; `undefined` when it can. */
export function pluginInstallUnavailableReason(request: {
  plugin: string
  agent: string
}): string | undefined {
  if (pluginProvider(request.agent)) {
    return undefined
  }
  return (
    `Orca cannot install or verify plugin skills for the "${request.agent}" agent. Install plugin ` +
    `"${request.plugin}" on this host with ${request.agent}'s own plugin command and use a ` +
    'repository-sourced skill instead, or run this node with the Claude Code agent.'
  )
}

function processOutput(result: ProcessResult): string {
  const text = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n')
  return text.length > MAX_REASON_OUTPUT_CHARS ? `${text.slice(0, MAX_REASON_OUTPUT_CHARS)}…` : text
}

export function createWorkflowPluginPort(host: PluginHostAccess): WorkflowPluginSkillPort {
  return {
    async isInstalled({ plugin, skill, agent }) {
      const provider = pluginProvider(agent)
      return provider ? provider.isInstalled(host, { plugin, skill }) : false
    },
    unavailableReason: pluginInstallUnavailableReason,
    async install({ plugin, agent }) {
      const provider = pluginProvider(agent)
      if (!provider) {
        return { ok: false, reason: pluginInstallUnavailableReason({ plugin, agent }) ?? '' }
      }
      const { program, args } = provider.installCommand(plugin)
      const manual = `Install plugin "${plugin}" on this host manually, then rerun the node.`
      let result: ProcessResult
      try {
        result = await host.runCli({
          program,
          args,
          cwd: host.workspaceRoot,
          timeoutMs: PLUGIN_INSTALL_TIMEOUT_MS
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, reason: `Could not run \`${program}\`: ${message}. ${manual}` }
      }
      if (result.code === 0) {
        return { ok: true }
      }
      const why = result.timedOut ? 'timed out' : `exited with code ${String(result.code)}`
      const output = processOutput(result)
      const command = [program, ...args].join(' ')
      return { ok: false, reason: `\`${command}\` ${why}${output ? `: ${output}` : ''}. ${manual}` }
    }
  }
}
