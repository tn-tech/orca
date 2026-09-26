import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/run-process'
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'
import type {
  ProvisionNodeSkillsInput,
  WorkflowPluginInstallResult,
  WorkflowSkillProvisioningPorts,
  WorkflowSkillTrustDecision
} from './workflow-skill-provisioning'
import { localWorkflowSkillFilesystem } from './workflow-skill-provisioning-host'

export const REPO_SOURCE = 'https://github.com/acme/consulting-skills'
export const repoSkill: SkillReference = {
  name: 'model-review',
  source: { kind: 'repository', location: REPO_SOURCE },
  required: true
}

/**
 * Fake `skills add`: lands the skill where the real CLI does for `--agent claude-code`.
 * `partial` writes those paths and still exits non-zero, like a CLI killed mid-install.
 */
export function fakeSkillsCli(
  workspaceRoot: string,
  result: Partial<ProcessResult> & { partial?: boolean } = {}
) {
  return vi.fn(async (spec: ProcessSpec): Promise<ProcessResult> => {
    const code = result.code === undefined ? 0 : result.code
    if (code === 0 || result.partial) {
      const skill = spec.args?.[spec.args.indexOf('--skill') + 1] ?? 'missing'
      for (const dir of ['.agents/skills', '.claude/skills']) {
        await mkdir(join(workspaceRoot, dir, skill), { recursive: true })
        await writeFile(join(workspaceRoot, dir, skill, 'SKILL.md'), `# ${skill}\n`)
      }
      await writeFile(join(workspaceRoot, 'skills-lock.json'), `{"cli":"${skill}"}`)
    }
    const timedOut = result.timedOut ?? false
    return { code, signal: null, stdout: '', stderr: result.stderr ?? '', timedOut }
  })
}

export function createSkillPorts(
  workspaceRoot: string,
  excludePath: string | null,
  overrides: Partial<Omit<WorkflowSkillProvisioningPorts, 'trust'>> & {
    trust?: WorkflowSkillTrustDecision
  } = {}
) {
  const { trust = 'needs-question', ...rest } = overrides
  const plugins = {
    isInstalled: vi.fn(async () => false),
    install: vi.fn(async (): Promise<WorkflowPluginInstallResult> => ({ ok: true }))
  }
  const trustGate = { decide: vi.fn(async () => trust) }
  const ports: WorkflowSkillProvisioningPorts = {
    runProcess: fakeSkillsCli(workspaceRoot),
    npxCommand: '/usr/local/bin/npx',
    fs: localWorkflowSkillFilesystem,
    resolveGitExcludePath: async () => excludePath,
    listTrackedPaths: vi.fn(async () => []),
    plugins,
    trust: trustGate,
    ...rest
  }
  return { ports, plugins, trustGate }
}

export function skillInput(
  workspaceRoot: string,
  overrides: Partial<ProvisionNodeSkillsInput> = {}
): ProvisionNodeSkillsInput {
  return {
    runId: 'wfr_1',
    agent: 'claude',
    skills: [repoSkill],
    workspaceRoot,
    readAllowlist: async () => ({ sources: [REPO_SOURCE], location: '/repo/orca.yaml' }),
    ...overrides
  }
}
