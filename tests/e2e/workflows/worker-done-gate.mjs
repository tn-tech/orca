#!/usr/bin/env node
/**
 * Stands in for the `ORCA` command the workflow stub agent runs. Every `orchestration send
 * --type worker_done` is held until WORKFLOW_E2E_GATE_FILE exists, so a test can keep a node's
 * attempt running for as long as it needs; everything else passes straight through to
 * WORKFLOW_E2E_REAL_ORCA. Each held send appends one line to WORKFLOW_E2E_GATE_LOG
 * (`held` on arrival, `sent <exit code>` after forwarding).
 *
 * Plain Node ESM: launched by the stub inside a worker PTY, where no TypeScript loader exists.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'

const GATE_TIMEOUT_MS = 180_000
const POLL_MS = 100

function requireEnv(name) {
  const value = (process.env[name] ?? '').trim()
  if (!value) {
    process.stderr.write(`worker-done-gate: ${name} is not set\n`)
    process.exit(1)
  }
  return value
}

const args = process.argv.slice(2)
const isWorkerDone =
  args[0] === 'orchestration' &&
  args[1] === 'send' &&
  args[args.indexOf('--type') + 1] === 'worker_done'
const [realProgram, ...realPrefixArgs] = requireEnv('WORKFLOW_E2E_REAL_ORCA').split(/\s+/)

let log = null
if (isWorkerDone) {
  const gateFile = requireEnv('WORKFLOW_E2E_GATE_FILE')
  log = requireEnv('WORKFLOW_E2E_GATE_LOG')
  appendFileSync(log, 'held\n')
  const deadline = Date.now() + GATE_TIMEOUT_MS
  while (!existsSync(gateFile)) {
    if (Date.now() > deadline) {
      process.stderr.write('worker-done-gate: gate never opened\n')
      process.exit(1)
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, POLL_MS))
  }
}
const forwarded = spawnSync(realProgram, [...realPrefixArgs, ...args], { stdio: 'inherit' })
if (log) {
  appendFileSync(log, `sent ${forwarded.status}\n`)
}
process.exit(forwarded.status ?? 1)
