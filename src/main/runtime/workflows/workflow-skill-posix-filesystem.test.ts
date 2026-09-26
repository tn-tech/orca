import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runProcess } from '../../../shared/child-process/run-process'
import { posixShellSkillFilesystem } from './workflow-skill-posix-filesystem'

// This machine's /bin/sh stands in for the SSH host's or the WSL distro's.
const fs = posixShellSkillFilesystem((script, args, input) =>
  runProcess({
    program: '/bin/sh',
    args: ['-c', script, 'sh', ...args],
    ...(input === undefined ? {} : { input })
  })
)

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-skill-posix-fs-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('posixShellSkillFilesystem', () => {
  it('reads null for a missing file and round-trips content with shell metacharacters', async () => {
    const path = join(root, 'dir with space', "it's $HOME.json")
    expect(await fs.readText(path)).toBeNull()

    await fs.writeText(path, '{"a":"$(rm -rf /)`x`"}\n')

    expect(await fs.readText(path)).toBe('{"a":"$(rm -rf /)`x`"}\n')
    expect(await fs.exists(path)).toBe(true)
  })

  it('counts a dangling symlink as present, like lstat', async () => {
    await symlink('missing-target', join(root, 'link'))
    expect(await fs.exists(join(root, 'link'))).toBe(true)
    expect(await fs.exists(join(root, 'nothing'))).toBe(false)
  })

  it('copies a tree keeping relative symlinks verbatim, replacing the destination', async () => {
    await mkdir(join(root, 'src/skill'), { recursive: true })
    await writeFile(join(root, 'src/skill/SKILL.md'), '# skill\n')
    await symlink('skill/SKILL.md', join(root, 'src/link'))
    await mkdir(join(root, 'dest/stale'), { recursive: true })

    await fs.copyPath(join(root, 'src'), join(root, 'dest'))

    expect(await readlink(join(root, 'dest/link'))).toBe('skill/SKILL.md')
    expect(await readFile(join(root, 'dest/skill/SKILL.md'), 'utf-8')).toBe('# skill\n')
    expect(await fs.exists(join(root, 'dest/stale'))).toBe(false)

    await fs.removePath(join(root, 'dest'))
    expect(await fs.exists(join(root, 'dest'))).toBe(false)
  })

  it('throws, never reports missing, when the host command fails', async () => {
    const failing = posixShellSkillFilesystem(async () => ({
      code: 1,
      signal: null,
      stdout: '',
      stderr: 'Permission denied',
      timedOut: false
    }))
    await expect(failing.exists('/x')).rejects.toThrow('Permission denied')
    await expect(failing.readText('/x')).rejects.toThrow('Permission denied')
    await expect(failing.writeText('/x', 'y')).rejects.toThrow('Permission denied')
  })
})
