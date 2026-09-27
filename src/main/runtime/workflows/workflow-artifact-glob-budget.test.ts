import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ARTIFACT_GLOB_LOCAL_MAX_DIRECTORIES_READ,
  ARTIFACT_GLOB_REMOTE_MAX_DIRECTORIES_READ,
  ARTIFACT_GLOB_TIME_BUDGET_MS
} from './workflow-artifact-glob'
import { captureArtifacts, fakeRemoteFilesystem } from './workflow-artifact-glob-test-fixtures'

const ws = '/home/dev/run'

/** `count` sibling dirs each holding a file; `plan.md` only in the last one. */
function wideTree(count: number): string[] {
  const names = Array.from({ length: count }, (_, i) => `d${String(i).padStart(4, '0')}`)
  return [...names.map((name) => `${name}/x.txt`), `${names.at(-1)}/plan.md`]
}

describe('artifact glob walk budgets', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops a remote walk at the remote directory budget and says so in detail', async () => {
    const reads: string[] = []
    const fs = fakeRemoteFilesystem(
      ws,
      { files: wideTree(ARTIFACT_GLOB_REMOTE_MAX_DIRECTORIES_READ + 50) },
      (dir) => reads.push(dir)
    )
    const outcome = await captureArtifacts(fs, ws, [{ path: '**/plan.md', required: true }], {
      remote: true
    })
    expect(outcome).toMatchObject({ ok: false, failureReason: 'artifact_missing' })
    expect(!outcome.ok && outcome.detail).toContain('"**/plan.md"')
    expect(!outcome.ok && outcome.detail).toContain('directories')
    // Excludes the literal-path existence check of `**/plan.md` itself.
    expect(reads.filter((dir) => !dir.includes('*'))).toHaveLength(
      ARTIFACT_GLOB_REMOTE_MAX_DIRECTORIES_READ
    )
  })

  it('lets a local walk use the larger local directory budget', async () => {
    expect(ARTIFACT_GLOB_LOCAL_MAX_DIRECTORIES_READ).toBeGreaterThan(
      ARTIFACT_GLOB_REMOTE_MAX_DIRECTORIES_READ + 51
    )
    const fs = fakeRemoteFilesystem(ws, {
      files: wideTree(ARTIFACT_GLOB_REMOTE_MAX_DIRECTORIES_READ + 50)
    })
    const outcome = await captureArtifacts(fs, ws, [{ path: '**/plan.md', required: true }])
    expect(outcome).toMatchObject({ ok: true })
    expect(outcome.ok && outcome.artifactGlobTruncations).toBeUndefined()
  })

  it('stops at the wall-clock budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const fs = fakeRemoteFilesystem(ws, { files: wideTree(10) }, () => {
      vi.setSystemTime(Date.now() + ARTIFACT_GLOB_TIME_BUDGET_MS / 3)
    })
    const outcome = await captureArtifacts(fs, ws, [{ path: '**/plan.md', required: true }])
    expect(outcome).toMatchObject({ ok: false, failureReason: 'artifact_missing' })
    expect(!outcome.ok && outcome.detail).toContain('time')
  })

  it('stops when the controller aborts mid-walk', async () => {
    const abort = new AbortController()
    const fs = fakeRemoteFilesystem(ws, { files: wideTree(10) }, () => abort.abort())
    const outcome = await captureArtifacts(fs, ws, [{ path: '**/plan.md', required: true }], {
      remote: true,
      signal: abort.signal
    })
    expect(outcome).toMatchObject({ ok: false, failureReason: 'artifact_missing' })
    expect(!outcome.ok && outcome.detail).toContain('aborted')
  })

  it('never descends into .git, and other dot dirs only for an explicit dot target', async () => {
    const reads: string[] = []
    const fs = fakeRemoteFilesystem(
      ws,
      { files: ['.git/plan.md', '.cache/plan.md', 'src/.config/plan.md', 'src/plan.md'] },
      (dir) => reads.push(dir.slice(ws.length + 1))
    )
    const outcome = await captureArtifacts(fs, ws, [
      { path: '**/plan.md', required: true },
      { path: '.*/plan.md', required: false },
      { path: '**/.config/*.md', required: false }
    ])
    expect(outcome).toMatchObject({
      ok: true,
      artifacts: [
        { path: 'src/plan.md', exists: true },
        { path: '.cache/plan.md', exists: true },
        { path: 'src/.config/plan.md', exists: true }
      ]
    })
    expect(reads.filter((dir) => dir.split('/').includes('.git'))).toEqual([])
    // `**/plan.md` has no dot target, so it read no dot directory at all.
    expect(reads.slice(0, reads.indexOf('src') + 1).some((dir) => dir.startsWith('.'))).toBe(false)
  })
})
