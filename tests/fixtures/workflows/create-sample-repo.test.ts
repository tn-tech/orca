import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { createSampleWorkflowRepo } from './create-sample-repo'

describe('createSampleWorkflowRepo', () => {
  it('creates a temp repo with the fixture files and one commit', async () => {
    const { repoPath } = await createSampleWorkflowRepo()

    expect(existsSync(join(repoPath, 'README.md'))).toBe(true)
    expect(readFileSync(join(repoPath, 'orca.yaml'), 'utf8')).toContain(
      'https://github.com/github/spec-kit'
    )
    expect(existsSync(join(repoPath, 'orca-workflows'))).toBe(true)
    const workflowFiles = readdirSync(join(repoPath, 'orca-workflows')).filter((name) =>
      name.endsWith('.workflow.yaml')
    )
    expect(workflowFiles).toEqual([])

    const isRepo = await runProcess({
      program: 'git',
      args: ['rev-parse', '--is-inside-work-tree'],
      cwd: repoPath
    })
    expect(isRepo.stdout.trim()).toBe('true')

    const log = await runProcess({ program: 'git', args: ['log', '--oneline'], cwd: repoPath })
    expect(log.stdout.trim().split('\n')).toHaveLength(1)

    const status = await runProcess({
      program: 'git',
      args: ['status', '--porcelain'],
      cwd: repoPath
    })
    expect(status.stdout.trim()).toBe('')
  })

  it('gives each call its own isolated temp repo', async () => {
    const first = await createSampleWorkflowRepo()
    const second = await createSampleWorkflowRepo()
    expect(first.repoPath).not.toBe(second.repoPath)
  })
})
