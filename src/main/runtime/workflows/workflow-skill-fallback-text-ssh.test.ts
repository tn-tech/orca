import { describe, expect, it, vi } from 'vitest'
import { validateGitExecArgs } from '../../../relay/git-exec-validator'

const SOURCE = 'https://github.com/acme/skills'
const SKILL_MD = '---\nname: plan\ndescription: Plans\n---\nPlan it.'

const gitExec = vi.fn(async (args: string[], _cwd: string) => {
  // The relay rejects anything outside its allowlist; run the real validator on what we send.
  validateGitExecArgs(args)
  return { stdout: args[0] === 'ls-files' ? 'README.md\0skills/plan/SKILL.md\0' : '', stderr: '' }
})
const fsProvider = {
  getTempDir: vi.fn(async () => '/remote/tmp'),
  createDir: vi.fn(async () => {}),
  readFile: vi.fn(async (path: string) => ({
    content: path.endsWith('orca.yaml')
      ? `workflows:\n  allowedSources:\n    - ${SOURCE}\n`
      : SKILL_MD,
    isBinary: false
  })),
  deletePath: vi.fn(async () => {})
}

vi.mock('../../providers/ssh-filesystem-dispatch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSshFilesystemProvider: vi.fn(() => fsProvider)
}))
vi.mock('../../providers/ssh-git-dispatch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireSshGitProvider: vi.fn(() => ({ exec: gitExec }))
}))

import { loadRunFallbackSkillTexts } from './workflow-skill-fallback-text'

describe('prompt-fallback skill fetch over SSH', () => {
  it('reads the allowlist and SKILL.md on the remote host with relay-accepted git argv', async () => {
    const texts = await loadRunFallbackSkillTexts(
      {
        orcaIgnoreTarget: { host: 'remote', repoPath: '/remote/project', connectionId: 'conn-1' }
      },
      {
        agent: 'aider',
        skills: [{ name: 'plan', source: { kind: 'repository', location: SOURCE }, required: true }]
      }
    )

    expect(texts.get('plan')).toEqual({
      source: SOURCE,
      path: 'skills/plan/SKILL.md',
      text: SKILL_MD
    })
    expect(fsProvider.readFile).toHaveBeenCalledWith('/remote/project/orca.yaml')
    expect(gitExec.mock.calls.map(([args]) => args)).toEqual([
      ['clone', '--', SOURCE, 'repo'],
      ['ls-files', '-z']
    ])
    const tempDir = gitExec.mock.calls[0]?.[1]
    expect(tempDir).toMatch(/^\/remote\/tmp\//)
    expect(fsProvider.readFile).toHaveBeenCalledWith(`${tempDir}/repo/skills/plan/SKILL.md`)
    expect(fsProvider.deletePath).toHaveBeenCalledWith(tempDir, true)
  })
})
