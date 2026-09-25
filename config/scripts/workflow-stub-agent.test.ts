import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPT_PATH = join(__dirname, 'workflow-stub-agent.mjs')
const FAKE_ORCA_PATH = join(__dirname, '__fixtures__', 'fake-orca-cli.mjs')

/** Reads a JSON array of strings written by the fake ORCA CLI fixture. */
function readArgvLog(path: string): string[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error(`expected ${path} to contain a JSON array of strings`)
  }
  return parsed
}

/** Sets up `.orca/workflow-runs/<run>/<attempt>/` with a brief.md and inputs.json. */
function createAttemptDir(): { root: string; attemptDir: string; briefPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'workflow-stub-agent-'))
  const attemptDir = join(root, '.orca', 'workflow-runs', 'run1', 'attempt1')
  mkdirSync(attemptDir, { recursive: true })
  const briefPath = join(attemptDir, 'brief.md')
  writeFileSync(briefPath, '# Role\nTest role.\n')
  return { root, attemptDir, briefPath }
}

function runStub(args: {
  argv?: string[]
  input?: string
  env: NodeJS.ProcessEnv
  cwd: string
}): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...(args.argv ?? [])], {
    cwd: args.cwd,
    input: args.input,
    env: { ...process.env, ...args.env },
    encoding: 'utf8'
  })
}

describe('workflow-stub-agent.mjs', () => {
  it('writes result.json and sends worker_done with outcome succeeded', () => {
    const { root, attemptDir, briefPath } = createAttemptDir()
    const argvLog = join(root, 'orca-argv.json')

    const result = runStub({
      argv: [briefPath],
      cwd: root,
      env: {
        ORCA: `${process.execPath} ${FAKE_ORCA_PATH}`,
        FAKE_ORCA_ARGV_LOG: argvLog,
        WORKFLOW_STUB_NODE_ID: 'implement',
        WORKFLOW_STUB_ITERATION: '1',
        WORKFLOW_STUB_SCRIPT: JSON.stringify({
          implement: { '1': { result: { summary: 'did the thing' } } }
        })
      }
    })

    expect(result.status, result.stderr).toBe(0)
    const reportPath = join(attemptDir, 'result.json')
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual({ summary: 'did the thing' })

    const argv = readArgvLog(argvLog)
    expect(argv).toEqual([
      'orchestration',
      'send',
      '--type',
      'worker_done',
      '--report-path',
      reportPath,
      '--outcome',
      'succeeded'
    ])
  })

  it('honors an explicit "failed" outcome in the scripted response', () => {
    const { root, briefPath } = createAttemptDir()
    const argvLog = join(root, 'orca-argv.json')

    const result = runStub({
      argv: [briefPath],
      cwd: root,
      env: {
        ORCA: `${process.execPath} ${FAKE_ORCA_PATH}`,
        FAKE_ORCA_ARGV_LOG: argvLog,
        WORKFLOW_STUB_NODE_ID: 'review',
        WORKFLOW_STUB_SCRIPT: JSON.stringify({
          review: { '1': { result: { approved: false, findings: [] }, outcome: 'failed' } }
        })
      }
    })

    expect(result.status, result.stderr).toBe(0)
    const argv = readArgvLog(argvLog)
    expect(argv.at(-1)).toBe('failed')
  })

  it('extracts the brief path from stdin when no argv is given', () => {
    const { root, attemptDir, briefPath } = createAttemptDir()
    const argvLog = join(root, 'orca-argv.json')
    const taskSpec = `Workflow "two-node" run run1, node "Implement" (attempt attempt1).\nRead and follow ${briefPath} before doing anything else.\n`

    const result = runStub({
      input: taskSpec,
      cwd: root,
      env: {
        ORCA: `${process.execPath} ${FAKE_ORCA_PATH}`,
        FAKE_ORCA_ARGV_LOG: argvLog,
        WORKFLOW_STUB_NODE_ID: 'implement',
        WORKFLOW_STUB_SCRIPT: JSON.stringify({ implement: { '1': { result: { summary: 'ok' } } } })
      }
    })

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(join(attemptDir, 'result.json'), 'utf8'))).toEqual({
      summary: 'ok'
    })
  })

  it('reads nodeId and iteration from inputs.json when the env override is absent', () => {
    const { root, attemptDir, briefPath } = createAttemptDir()
    writeFileSync(
      join(attemptDir, 'inputs.json'),
      JSON.stringify({ nodeId: 'review', iteration: 2 })
    )
    const argvLog = join(root, 'orca-argv.json')

    const result = runStub({
      argv: [briefPath],
      cwd: root,
      env: {
        ORCA: `${process.execPath} ${FAKE_ORCA_PATH}`,
        FAKE_ORCA_ARGV_LOG: argvLog,
        WORKFLOW_STUB_SCRIPT: JSON.stringify({
          review: { '2': { result: { approved: true, findings: [] } } }
        })
      }
    })

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(join(attemptDir, 'result.json'), 'utf8'))).toEqual({
      approved: true,
      findings: []
    })
  })

  it('fails loudly when the scripted table has no entry for the node/iteration', () => {
    const { root, briefPath } = createAttemptDir()

    const result = runStub({
      argv: [briefPath],
      cwd: root,
      env: {
        ORCA: `${process.execPath} ${FAKE_ORCA_PATH}`,
        WORKFLOW_STUB_NODE_ID: 'implement',
        WORKFLOW_STUB_SCRIPT: JSON.stringify({ review: { '1': { result: {} } } })
      }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('no entry for node "implement" iteration 1')
  })

  it('fails loudly when ORCA is not set', () => {
    const { root, briefPath } = createAttemptDir()

    const result = runStub({
      argv: [briefPath],
      cwd: root,
      env: {
        ORCA: '',
        WORKFLOW_STUB_NODE_ID: 'implement',
        WORKFLOW_STUB_SCRIPT: JSON.stringify({ implement: { '1': { result: {} } } })
      }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ORCA is not set')
  })
})
