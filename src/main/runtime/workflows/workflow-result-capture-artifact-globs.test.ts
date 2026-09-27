import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ResultContract } from '../../../shared/workflows/workflow-definition-types'
import { ARTIFACT_GLOB_MAX_DEPTH, ARTIFACT_GLOB_MAX_MATCHES } from './workflow-artifact-glob'
import type { WorkflowFilesystem } from './workflow-file-store-filesystem'
import { localWorkflowFilesystem } from './workflow-file-store-filesystem'
import { captureNodeResult } from './workflow-result-capture'

const runId = 'run-1'
const attemptId = 'attempt-1'
const reportPath = `.orca/workflow-runs/${runId}/${attemptId}/result.json`
const resultContract: ResultContract = { type: 'object', properties: {} }

function capture(
  fs: WorkflowFilesystem,
  workspaceRoot: string,
  declaredArtifacts: { path: string; required: boolean }[]
) {
  return captureNodeResult({
    fs,
    workspaceRoot,
    runId,
    attemptId,
    reportPath,
    outcome: 'succeeded',
    resultContract,
    declaredArtifacts
  })
}

describe('captureNodeResult artifact globs (local workspace)', () => {
  let root: string
  let workspaceRoot: string
  let outside: string

  async function touch(relativePath: string, base = workspaceRoot): Promise<void> {
    const target = join(base, relativePath)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, 'x', 'utf-8')
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'workflow-artifact-glob-'))
    workspaceRoot = join(root, 'workspace')
    outside = join(root, 'outside')
    await mkdir(outside, { recursive: true })
    await touch(reportPath)
    await writeFile(join(workspaceRoot, reportPath), '{}', 'utf-8')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('records the one concrete path a ** glob matches', async () => {
    await touch('specs/001-feature/plan.md')
    const outcome = await capture(localWorkflowFilesystem, workspaceRoot, [
      { path: 'specs/**/plan.md', required: true }
    ])
    expect(outcome).toEqual({
      ok: true,
      result: {},
      artifacts: [{ path: 'specs/001-feature/plan.md', exists: true }]
    })
  })

  it('records every concrete path a ** glob matches, sorted', async () => {
    await touch('specs/plan.md')
    await touch('specs/b/c/plan.md')
    await touch('specs/a/plan.md')
    await touch('specs/a/notes.md')
    const outcome = await capture(localWorkflowFilesystem, workspaceRoot, [
      { path: 'specs/**/plan.md', required: true }
    ])
    expect(outcome).toMatchObject({
      ok: true,
      artifacts: [
        { path: 'specs/a/plan.md', exists: true },
        { path: 'specs/b/c/plan.md', exists: true },
        { path: 'specs/plan.md', exists: true }
      ]
    })
  })

  it('fails artifact_missing when a required glob matches nothing', async () => {
    await touch('specs/a/notes.md')
    const outcome = await capture(localWorkflowFilesystem, workspaceRoot, [
      { path: 'specs/**/plan.md', required: true }
    ])
    expect(outcome).toEqual({
      ok: false,
      failureReason: 'artifact_missing',
      result: {},
      artifacts: [{ path: 'specs/**/plan.md', exists: false }]
    })
  })

  it('does not fail when an optional glob matches nothing', async () => {
    const outcome = await capture(localWorkflowFilesystem, workspaceRoot, [
      { path: 'out/*.log', required: false }
    ])
    expect(outcome).toEqual({
      ok: true,
      result: {},
      artifacts: [{ path: 'out/*.log', exists: false }]
    })
  })

  it('keeps a literal path working as before, including a directory', async () => {
    await touch('out/report.md')
    const outcome = await capture(localWorkflowFilesystem, workspaceRoot, [
      { path: 'out/report.md', required: true },
      { path: 'out', required: true }
    ])
    expect(outcome).toMatchObject({
      ok: true,
      artifacts: [
        { path: 'out/report.md', exists: true },
        { path: 'out', exists: true }
      ]
    })
  })

  it('still treats a literal file name containing glob syntax as a literal path', async () => {
    await touch('app/[id]/page.tsx')
    const outcome = await capture(localWorkflowFilesystem, workspaceRoot, [
      { path: 'app/[id]/page.tsx', required: true }
    ])
    expect(outcome).toMatchObject({
      ok: true,
      artifacts: [{ path: 'app/[id]/page.tsx', exists: true }]
    })
  })

  it.each(['../outside/**/plan.md', '**/../../outside/*.md'])(
    'refuses a glob that climbs out of the workspace: %s',
    async (pattern) => {
      await touch('plan.md', outside)
      const outcome = await capture(localWorkflowFilesystem, workspaceRoot, [
        { path: pattern, required: true }
      ])
      expect(outcome).toMatchObject({
        ok: false,
        failureReason: 'artifact_missing',
        artifacts: [{ path: pattern, exists: false }]
      })
    }
  )

  it('refuses an absolute glob even when it would match', async () => {
    await touch('plan.md', outside)
    const pattern = `${outside.replace(/\\/g, '/')}/*.md`
    const outcome = await capture(localWorkflowFilesystem, workspaceRoot, [
      { path: pattern, required: true }
    ])
    expect(outcome).toMatchObject({ ok: false, failureReason: 'artifact_missing' })
  })

  it('never matches through or at a symlink that escapes the workspace', async () => {
    await touch('nested/plan.md', outside)
    await touch('plan.md', outside)
    await mkdir(join(workspaceRoot, 'specs'), { recursive: true })
    await symlink(outside, join(workspaceRoot, 'specs/linked-dir'), 'dir')
    await symlink(join(outside, 'plan.md'), join(workspaceRoot, 'specs/plan.md'), 'file')
    await symlink(outside, join(workspaceRoot, 'escape'), 'dir')
    const outcome = await capture(localWorkflowFilesystem, workspaceRoot, [
      { path: 'specs/**/plan.md', required: true },
      { path: 'escape/**/*.md', required: false }
    ])
    expect(outcome).toMatchObject({
      ok: false,
      failureReason: 'artifact_missing',
      artifacts: [
        { path: 'specs/**/plan.md', exists: false },
        { path: 'escape/**/*.md', exists: false }
      ]
    })
  })

  it(`stops at ${ARTIFACT_GLOB_MAX_MATCHES} matches`, async () => {
    await mkdir(join(workspaceRoot, 'many'), { recursive: true })
    await Promise.all(
      Array.from({ length: ARTIFACT_GLOB_MAX_MATCHES + 5 }, (_, index) =>
        writeFile(join(workspaceRoot, 'many', `f${String(index).padStart(5, '0')}.txt`), 'x')
      )
    )
    const outcome = await capture(localWorkflowFilesystem, workspaceRoot, [
      { path: 'many/**/*.txt', required: true }
    ])
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.artifacts).toHaveLength(ARTIFACT_GLOB_MAX_MATCHES)
  })

  it(`does not walk deeper than ${ARTIFACT_GLOB_MAX_DEPTH} directory levels`, async () => {
    const tooDeep = Array.from({ length: ARTIFACT_GLOB_MAX_DEPTH + 1 }, (_, i) => `d${i}`)
    await touch([...tooDeep, 'plan.md'].join('/'))
    await touch('d0/plan.md')
    const outcome = await capture(localWorkflowFilesystem, workspaceRoot, [
      { path: '**/plan.md', required: true }
    ])
    expect(outcome).toMatchObject({
      ok: true,
      artifacts: [{ path: 'd0/plan.md', exists: true }]
    })
  })
})

type FakeNode = { kind: 'file' } | { kind: 'dir' } | { kind: 'symlink'; toDir: boolean }

/** SSH-shaped provider: posix root, readDir reports symlinked dirs as directories. */
function fakeRemoteFilesystem(tree: Record<string, FakeNode>): WorkflowFilesystem {
  const notUsed = async (): Promise<never> => {
    throw new Error('not used')
  }
  return {
    async readDir(dirPath) {
      if (tree[dirPath]?.kind !== 'dir') {
        throw new Error(`ENOENT ${dirPath}`)
      }
      return Object.entries(tree)
        .filter(
          ([path]) =>
            path.startsWith(`${dirPath}/`) && !path.slice(dirPath.length + 1).includes('/')
        )
        .map(([path, node]) => ({
          name: path.slice(dirPath.length + 1),
          isDirectory: node.kind === 'dir' || (node.kind === 'symlink' && node.toDir),
          isSymlink: node.kind === 'symlink'
        }))
    },
    async readFile(filePath) {
      if (tree[filePath]?.kind !== 'file') {
        throw new Error(`ENOENT ${filePath}`)
      }
      return '{}'
    },
    writeFile: notUsed,
    deletePath: notUsed,
    createDir: notUsed
  }
}

describe('captureNodeResult artifact globs (SSH-shaped provider)', () => {
  const ws = '/home/dev/run'
  const tree: Record<string, FakeNode> = {
    [ws]: { kind: 'dir' },
    [`${ws}/.orca`]: { kind: 'dir' },
    [`${ws}/.orca/workflow-runs`]: { kind: 'dir' },
    [`${ws}/.orca/workflow-runs/${runId}`]: { kind: 'dir' },
    [`${ws}/.orca/workflow-runs/${runId}/${attemptId}`]: { kind: 'dir' },
    [`${ws}/${reportPath}`]: { kind: 'file' },
    [`${ws}/specs`]: { kind: 'dir' },
    [`${ws}/specs/001`]: { kind: 'dir' },
    [`${ws}/specs/001/plan.md`]: { kind: 'file' },
    [`${ws}/specs/link`]: { kind: 'symlink', toDir: true }
  }

  it('matches through the provider readDir and skips symlinked directories', async () => {
    const outcome = await capture(fakeRemoteFilesystem(tree), ws, [
      { path: 'specs/**/plan.md', required: true },
      { path: 'specs/*', required: false }
    ])
    expect(outcome).toEqual({
      ok: true,
      result: {},
      artifacts: [
        { path: 'specs/001/plan.md', exists: true },
        { path: 'specs/001', exists: true }
      ]
    })
  })
})
