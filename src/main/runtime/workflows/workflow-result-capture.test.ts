import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ResultContract } from '../../../shared/workflows/workflow-definition-types'
import { localWorkflowFilesystem } from './workflow-file-store-filesystem'
import { captureNodeResult } from './workflow-result-capture'

const runId = 'run-1'
const attemptId = 'attempt-1'
const attemptDir = `.orca/workflow-runs/${runId}/${attemptId}`
const reportPath = `${attemptDir}/result.json`

const resultContract: ResultContract = {
  type: 'object',
  required: ['summary'],
  properties: { summary: { type: 'string' } }
}

describe('captureNodeResult', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-result-capture-'))
    await mkdir(join(workspaceRoot, attemptDir), { recursive: true })
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  function capture(overrides: {
    reportPath?: string | null
    outcome?: 'succeeded' | 'failed'
    declaredArtifacts?: { path: string; required: boolean }[]
    contract?: ResultContract
  }) {
    return captureNodeResult({
      fs: localWorkflowFilesystem,
      workspaceRoot,
      runId,
      attemptId,
      reportPath: overrides.reportPath ?? reportPath,
      outcome: overrides.outcome ?? 'succeeded',
      resultContract: overrides.contract ?? resultContract,
      declaredArtifacts: overrides.declaredArtifacts ?? []
    })
  }

  it('fails result_missing when reportPath is absent', async () => {
    const outcome = await capture({ reportPath: null })
    expect(outcome).toEqual({ ok: false, failureReason: 'result_missing' })
  })

  it('fails result_missing when reportPath escapes the attempt directory', async () => {
    await writeFile(join(workspaceRoot, '.orca/other.json'), '{"summary":"ok"}', 'utf-8')
    const outcome = await capture({ reportPath: '.orca/other.json' })
    expect(outcome).toEqual({ ok: false, failureReason: 'result_missing' })
  })

  it('fails result_missing when reportPath tries to escape via ..', async () => {
    const outcome = await capture({ reportPath: `${attemptDir}/../../escape.json` })
    expect(outcome).toEqual({ ok: false, failureReason: 'result_missing' })
  })

  it('fails result_missing when the reported file does not exist on disk', async () => {
    const outcome = await capture({})
    expect(outcome).toEqual({ ok: false, failureReason: 'result_missing' })
  })

  it('fails result_invalid with the raw body kept when the file is not valid JSON', async () => {
    const raw = '{not json'
    await writeFile(join(workspaceRoot, reportPath), raw, 'utf-8')
    const outcome = await capture({})
    expect(outcome).toEqual({ ok: false, failureReason: 'result_invalid', rawBody: raw })
  })

  it('fails result_invalid with the raw body kept on a schema violation', async () => {
    const raw = '{"summary": 42}'
    await writeFile(join(workspaceRoot, reportPath), raw, 'utf-8')
    const outcome = await capture({})
    expect(outcome).toEqual({ ok: false, failureReason: 'result_invalid', rawBody: raw })
  })

  it('fails artifact_missing when a required artifact does not exist', async () => {
    await writeFile(join(workspaceRoot, reportPath), '{"summary":"ok"}', 'utf-8')
    const outcome = await capture({
      declaredArtifacts: [{ path: 'out/report.md', required: true }]
    })
    expect(outcome).toEqual({
      ok: false,
      failureReason: 'artifact_missing',
      result: { summary: 'ok' },
      artifacts: [{ path: 'out/report.md', exists: false }]
    })
  })

  it('does not fail artifact_missing for a missing optional artifact', async () => {
    await writeFile(join(workspaceRoot, reportPath), '{"summary":"ok"}', 'utf-8')
    const outcome = await capture({
      declaredArtifacts: [{ path: 'out/optional.md', required: false }]
    })
    expect(outcome).toEqual({
      ok: true,
      result: { summary: 'ok' },
      artifacts: [{ path: 'out/optional.md', exists: false }]
    })
  })

  it('fails even with a valid result when the worker reports outcome failed', async () => {
    await writeFile(join(workspaceRoot, reportPath), '{"summary":"ok"}', 'utf-8')
    const outcome = await capture({ outcome: 'failed' })
    expect(outcome).toEqual({
      ok: false,
      result: { summary: 'ok' },
      artifacts: []
    })
    expect(outcome).not.toHaveProperty('failureReason')
  })

  it('stores the valid result with its artifacts list on success', async () => {
    await mkdir(join(workspaceRoot, 'out'), { recursive: true })
    await writeFile(join(workspaceRoot, 'out/report.md'), '# done', 'utf-8')
    await writeFile(join(workspaceRoot, reportPath), '{"summary":"ok"}', 'utf-8')
    const outcome = await capture({
      declaredArtifacts: [{ path: 'out/report.md', required: true }]
    })
    expect(outcome).toEqual({
      ok: true,
      result: { summary: 'ok' },
      artifacts: [{ path: 'out/report.md', exists: true }]
    })
  })

  it('merges result.json artifacts beyond the node-declared list', async () => {
    await writeFile(join(workspaceRoot, 'extra.txt'), 'x', 'utf-8')
    await writeFile(
      join(workspaceRoot, reportPath),
      JSON.stringify({ summary: 'ok', artifacts: ['extra.txt'] }),
      'utf-8'
    )
    const outcome = await capture({})
    expect(outcome).toEqual({
      ok: true,
      result: { summary: 'ok' },
      artifacts: [{ path: 'extra.txt', exists: true }]
    })
  })
})
