import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gitExecFileAsync } from '../../git/runner'
import { listLocalTrackedPaths, resolveLocalGitExcludePath } from './workflow-skill-local-git'

let root: string
let repo: string
let worktree: string

async function git(cwd: string, args: string[]): Promise<void> {
  await gitExecFileAsync(args, { cwd })
}

beforeAll(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'orca-skill-git-')))
  repo = join(root, 'repo')
  worktree = join(root, 'run-worktree')
  await mkdir(join(repo, '.claude/skills/committed'), { recursive: true })
  await writeFile(join(repo, '.claude/skills/committed/SKILL.md'), '# committed\n')
  await git(repo, ['init', '-q'])
  await git(repo, ['add', '.'])
  await git(repo, [
    '-c',
    'user.name=Orca Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-q',
    '-m',
    'init'
  ])
  await git(repo, ['worktree', 'add', '-q', '--detach', worktree])
}, 30_000)

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('local git reads for skill provisioning', () => {
  it("resolves a linked worktree's exclude file to the common git dir", async () => {
    expect(await resolveLocalGitExcludePath(worktree)).toBe(join(repo, '.git', 'info', 'exclude'))
    expect(await resolveLocalGitExcludePath(repo)).toBe(join(repo, '.git', 'info', 'exclude'))
  })

  it('reports which install targets git tracks, including directories', async () => {
    expect(
      await listLocalTrackedPaths(worktree, [
        '.agents/skills/committed',
        '.claude/skills/committed',
        'skills-lock.json'
      ])
    ).toEqual(['.claude/skills/committed'])
  })

  it('treats a folder without git as having nothing tracked and no exclude file', async () => {
    const folder = join(root, 'folder')
    await mkdir(folder, { recursive: true })
    expect(await resolveLocalGitExcludePath(folder)).toBeNull()
    expect(await listLocalTrackedPaths(folder, ['skills-lock.json'])).toEqual([])
  })
})
