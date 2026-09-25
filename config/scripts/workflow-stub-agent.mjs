#!/usr/bin/env node
/**
 * Deterministic stand-in for a real agent CLI (Claude, Codex, ...), used by
 * Visual DAG Workflow tests as the worker a node launches. Given a scripted
 * response table, it plays out the worker side of the contract in
 * specs/001-visual-dag-workflows/contracts/agent-brief.md without ever
 * calling a model.
 *
 * Protocol:
 * 1. Find the brief path. Either `process.argv[2]` is the path directly, or
 *    it is read from stdin: the engine's taskSpec always contains the literal
 *    substring ".orca/workflow-runs/<runId>/<attemptId>/brief.md", which is
 *    extracted with a regex. This mirrors how a real agent is launched: the
 *    override command in stub-agent-launch-override.ts takes no arguments,
 *    so the taskSpec text is delivered the same way a real CLI's initial
 *    prompt is (stdin-after-start); direct argv invocation exists for tests.
 * 2. The attempt directory is `dirname(briefPath)`. Node id and iteration
 *    come from `WORKFLOW_STUB_NODE_ID` / `WORKFLOW_STUB_ITERATION` env vars
 *    if set, otherwise from `nodeId` / `iteration` in that directory's
 *    `inputs.json` (iteration defaults to 1).
 * 3. `WORKFLOW_STUB_SCRIPT` is a JSON env var shaped
 *    `{ [nodeId]: { [iteration]: { result: object, outcome?: 'succeeded' | 'failed' } } }`.
 *    The entry for this node id + iteration is looked up; missing entries
 *    are a fatal error, so an unscripted attempt fails loudly instead of
 *    hanging.
 * 4. `result.outcome` (default 'succeeded') is written to
 *    `<attemptDir>/result.json`, then this script runs, via the `ORCA`
 *    executable from env:
 *      orca orchestration send --type worker_done \
 *        --report-path <attemptDir>/result.json --outcome <succeeded|failed>
 *    matching the "worker_done" completion step in agent-brief.md. The
 *    script's own exit code is `orca orchestration send`'s exit code.
 *    `ORCA` is split on whitespace into a program plus leading args (e.g.
 *    "node /abs/path/out/cli/index.js"), so it can name an interpreter
 *    explicitly instead of only a directly-executable binary; no quoting is
 *    supported, which is fine for the plain paths this env var carries.
 *
 * Plain Node ESM, no dependencies. Spawns `ORCA` directly via node:child_process
 * (not src/shared/child-process/run-process.ts) because this file runs as a
 * real launched process outside src/, where no TypeScript loader is available.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

function fail(message) {
  process.stderr.write(`workflow-stub-agent: ${message}\n`)
  process.exit(1)
}

function readStdinText() {
  if (process.stdin.isTTY) {
    return ''
  }
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function resolveBriefPath() {
  const argPath = process.argv[2]
  if (argPath) {
    return argPath
  }
  const stdinText = readStdinText()
  const match = stdinText.match(/\S*\.orca\/workflow-runs\/\S+?\/brief\.md/)
  if (!match) {
    fail('no brief path given as argv[2] or found in stdin')
  }
  return match[0]
}

function resolveNodeContext(attemptDir) {
  const envNodeId = process.env.WORKFLOW_STUB_NODE_ID
  const envIteration = process.env.WORKFLOW_STUB_ITERATION
  if (envNodeId) {
    return { nodeId: envNodeId, iteration: envIteration ? Number(envIteration) : 1 }
  }
  const inputsPath = join(attemptDir, 'inputs.json')
  if (!existsSync(inputsPath)) {
    fail(`no WORKFLOW_STUB_NODE_ID and no inputs.json at ${inputsPath}`)
  }
  const inputs = JSON.parse(readFileSync(inputsPath, 'utf8'))
  if (!inputs.nodeId) {
    fail(`${inputsPath} has no "nodeId" field`)
  }
  return { nodeId: inputs.nodeId, iteration: inputs.iteration ?? 1 }
}

function resolveScriptedResponse(nodeId, iteration) {
  const raw = process.env.WORKFLOW_STUB_SCRIPT
  if (!raw) {
    fail('WORKFLOW_STUB_SCRIPT is not set')
  }
  let table
  try {
    table = JSON.parse(raw)
  } catch (error) {
    fail(`WORKFLOW_STUB_SCRIPT is not valid JSON: ${error.message}`)
  }
  const entry = table[nodeId]?.[String(iteration)]
  if (!entry) {
    fail(`WORKFLOW_STUB_SCRIPT has no entry for node "${nodeId}" iteration ${iteration}`)
  }
  return { result: entry.result, outcome: entry.outcome ?? 'succeeded' }
}

function main() {
  const briefPath = resolveBriefPath()
  const attemptDir = dirname(briefPath)
  const { nodeId, iteration } = resolveNodeContext(attemptDir)
  const { result, outcome } = resolveScriptedResponse(nodeId, iteration)

  const reportPath = join(attemptDir, 'result.json')
  writeFileSync(reportPath, JSON.stringify(result, null, 2))

  const orcaCommand = (process.env.ORCA ?? '').trim()
  if (!orcaCommand) {
    fail('ORCA is not set to the orca CLI executable')
  }
  const [orcaProgram, ...orcaPrefixArgs] = orcaCommand.split(/\s+/)

  const send = spawnSync(
    orcaProgram,
    [
      ...orcaPrefixArgs,
      'orchestration',
      'send',
      '--type',
      'worker_done',
      '--report-path',
      reportPath,
      '--outcome',
      outcome
    ],
    { cwd: process.cwd(), stdio: 'inherit' }
  )
  if (send.error) {
    fail(`failed to run ORCA orchestration send: ${send.error.message}`)
  }
  process.exit(send.status ?? 1)
}

main()
