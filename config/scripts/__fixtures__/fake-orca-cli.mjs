#!/usr/bin/env node
// Test double for the real `orca` executable: records the argv it was called
// with (so workflow-stub-agent.test.ts can assert on it) and exits 0.
import { writeFileSync } from 'node:fs'

const argvLogPath = process.env.FAKE_ORCA_ARGV_LOG
if (argvLogPath) {
  writeFileSync(argvLogPath, JSON.stringify(process.argv.slice(2)))
}
process.exit(0)
