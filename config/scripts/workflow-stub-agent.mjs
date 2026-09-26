#!/usr/bin/env node
/**
 * Deterministic stand-in for a real agent CLI (Claude, Codex, ...), used by
 * Visual DAG Workflow tests as the worker a node launches. Given a scripted
 * response table, it plays out the worker side of the contract in
 * specs/001-visual-dag-workflows/contracts/agent-brief.md without ever
 * calling a model.
 *
 * Protocol:
 * 1. Find the brief path. Either an argv entry ending in `brief.md` names it
 *    directly (other argv, e.g. launch-time `--model` flags, is ignored), or
 *    it is read from the prompt on stdin: the engine's taskSpec always
 *    contains the literal substring
 *    ".orca/workflow-runs/<runId>/<attemptId>/brief.md", which is extracted
 *    with a regex. A worker started by `orchestration.workerStart` gets its
 *    prompt the way a real TUI does — a bracketed paste typed into its PTY —
 *    so on a TTY stdin is read in raw mode until the paste-end marker and the
 *    Enter that submits it; piped stdin is read to EOF (direct invocation
 *    from tests).
 * 2. The attempt directory is `dirname(briefPath)`. Node id and iteration
 *    come from `WORKFLOW_STUB_NODE_ID` / `WORKFLOW_STUB_ITERATION` env vars
 *    if set, otherwise from `nodeId` / `iteration` in that directory's
 *    `inputs.json` (iteration defaults to 1 only if absent; the engine
 *    writes 0 for non-loop nodes).
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
 *    matching the "worker_done" completion step in agent-brief.md. When the
 *    prompt carried the dispatch preamble, the identity flags from its
 *    worker_done recipe (--from, --dispatch-capability, --task-id,
 *    --dispatch-id) plus a --subject/--body are appended, as a real worker
 *    following the preamble would. The script's own exit code is
 *    `orca orchestration send`'s exit code.
 *    `ORCA` is split on whitespace into a program plus leading args (e.g.
 *    "node /abs/path/out/cli/index.js"), so it can name an interpreter
 *    explicitly instead of only a directly-executable binary; no quoting is
 *    supported, which is fine for the plain paths this env var carries.
 *
 * On a TTY the stub also paints the OSC titles a real TUI would — idle before
 * the prompt, working after it — because workerStart only pastes into a pane
 * whose title proves `tui-idle`, then looks for the turn-start edge.
 * It likewise feeds the Orca-managed hook script a real CLI would run
 * (`$HOME/.orca/agent-hooks/<agent>-hook.sh`: UserPromptSubmit, then Stop), so
 * the worker shows up in the agent status store like any other agent, and it
 * stays at its idle prompt after worker_done instead of exiting.
 * `--as <agent>` (from stub-agent-launch-override.ts) picks whose title
 * vocabulary and hook script to use; it defaults to claude.
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

const BRIEF_PATH_PATTERN = /\S*\.orca\/workflow-runs\/\S+?\/brief\.md/
const PASTE_END = '\u001b[201~'
const PROMPT_TIMEOUT_MS = 60_000
// Titles the runtime's title classifier reads as that agent's idle / working state.
const AGENT_TITLES = {
  claude: { idle: '\u2733 Claude Code', working: '\u2810 Claude Code' },
  codex: { idle: 'Codex ready', working: '\u280b Codex is thinking' }
}

function resolveStubAgent() {
  const asIndex = process.argv.indexOf('--as')
  const agent = asIndex === -1 ? undefined : process.argv[asIndex + 1]
  return agent && AGENT_TITLES[agent] ? agent : 'claude'
}

// Best effort, like a real CLI's hooks: a missing script or failed post never fails the turn.
function emitAgentHook(payload) {
  const hookScript = join(
    process.env.HOME ?? '',
    '.orca',
    'agent-hooks',
    `${resolveStubAgent()}-hook.sh`
  )
  if (process.platform === 'win32' || !existsSync(hookScript)) {
    return
  }
  spawnSync('/bin/sh', [hookScript], {
    input: JSON.stringify(payload),
    stdio: ['pipe', 'ignore', 'ignore']
  })
}

function paintTitle(title) {
  if (process.stdout.isTTY) {
    process.stdout.write(`\u001b]0;${title}\u0007`)
  }
}

function readPipedStdinText() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

// Why raw mode: a canonical-mode TTY caps a line (1024 bytes on macOS) and only
// releases input per line; the paste-end marker plus Enter is the prompt's true boundary.
function readTtyPromptText() {
  return new Promise((resolve) => {
    let text = ''
    const onData = (chunk) => {
      text += String(chunk)
      // Why wait for the Enter after the paste: that submit is the turn start the runtime observes.
      const pasteEnd = text.indexOf(PASTE_END)
      if (pasteEnd !== -1 && /[\r\n]/.test(text.slice(pasteEnd + PASTE_END.length))) {
        finish()
      }
    }
    const finish = () => {
      clearTimeout(timer)
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      resolve(text)
    }
    const timer = setTimeout(finish, PROMPT_TIMEOUT_MS)
    process.stdin.setRawMode(true)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', onData)
  })
}

function stripPasteMarkers(text) {
  return text.replaceAll('\u001b[200~', '').replaceAll(PASTE_END, '').replace(/\r/g, '\n').trim()
}

async function readPromptText() {
  if (!process.stdin.isTTY) {
    return readPipedStdinText()
  }
  const titles = AGENT_TITLES[resolveStubAgent()]
  paintTitle(titles.idle)
  const text = await readTtyPromptText()
  paintTitle(titles.working)
  emitAgentHook({ hook_event_name: 'UserPromptSubmit', prompt: stripPasteMarkers(text) })
  return text
}

function resolveBriefPath(promptText) {
  const argPath = process.argv.slice(2).find((arg) => arg.endsWith('brief.md'))
  if (argPath) {
    return argPath
  }
  const match = promptText.match(BRIEF_PATH_PATTERN)
  if (!match) {
    fail('no brief.md path given in argv or found in the stdin prompt')
  }
  return match[0]
}

/** Identity flags from the preamble's worker_done recipe, so the send lands on this Dispatch. */
function resolveWorkerDoneIdentityArgs(promptText) {
  const recipe = promptText.split(/\r?\n/).find((line) => line.includes('--type worker_done'))
  if (!recipe) {
    return []
  }
  const args = []
  for (const flag of ['--from', '--dispatch-capability', '--task-id', '--dispatch-id']) {
    const value = recipe.match(new RegExp(`${flag} (\\S+)`))?.[1]
    if (value) {
      args.push(flag, value)
    }
  }
  return [
    ...args,
    '--subject',
    'stub agent done',
    '--body',
    'Workflow stub agent played its scripted result.'
  ]
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

async function main() {
  const argvBriefPath = process.argv.slice(2).some((arg) => arg.endsWith('brief.md'))
  const promptText = argvBriefPath ? '' : await readPromptText()
  const briefPath = resolveBriefPath(promptText)
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
      outcome,
      ...resolveWorkerDoneIdentityArgs(promptText)
    ],
    { cwd: process.cwd(), stdio: 'inherit' }
  )
  if (send.error) {
    fail(`failed to run ORCA orchestration send: ${send.error.message}`)
  }
  if (send.status !== 0 || !process.stdin.isTTY) {
    process.exit(send.status ?? 1)
  }
  emitAgentHook({ hook_event_name: 'Stop', last_assistant_message: 'Workflow stub agent done.' })
  paintTitle(AGENT_TITLES[resolveStubAgent()].idle)
  // Idle at the prompt like a real TUI until the pane closes (SIGHUP ends the process).
  setInterval(() => {}, 60_000)
}

await main()
