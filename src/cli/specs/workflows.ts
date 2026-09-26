import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const WORKFLOW_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['workflows', 'list'],
    summary: 'List workflow definitions in a repo',
    usage: 'orca workflows list [--repo <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo'],
    examples: ['orca workflows list', 'orca workflows list --repo my-repo --json']
  },
  {
    path: ['workflows', 'show'],
    summary: 'Show one workflow definition',
    usage: 'orca workflows show <name> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name'],
    positionalArgs: ['name'],
    examples: ['orca workflows show release-review', 'orca workflows show release-review --json']
  },
  {
    path: ['workflows', 'validate'],
    summary: 'Validate a workflow definition',
    usage: 'orca workflows validate <name> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name'],
    positionalArgs: ['name'],
    notes: ['Exits with status 1 if the workflow has any error-severity problems.'],
    examples: ['orca workflows validate release-review']
  },
  {
    path: ['workflows', 'run'],
    summary: 'Start a workflow run',
    usage: 'orca workflows run <name> --objective <text> [--concurrency <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'objective', 'concurrency'],
    positionalArgs: ['name'],
    examples: [
      'orca workflows run release-review --objective "Ship the 2.4 release"',
      'orca workflows run release-review --objective "Ship it" --concurrency 3'
    ]
  },
  {
    path: ['workflows', 'runs'],
    summary: 'List workflow runs',
    usage: 'orca workflows runs [<name>] [--state <s>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'state'],
    positionalArgs: ['name'],
    examples: ['orca workflows runs', 'orca workflows runs release-review --state running']
  },
  {
    path: ['workflows', 'status'],
    summary: 'Show a workflow run and its recent events',
    usage: 'orca workflows status <run-id> [--wait] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run-id', 'wait'],
    positionalArgs: ['run-id'],
    notes: ['--wait polls the run until it reaches a terminal state (completed/failed/cancelled).'],
    examples: ['orca workflows status run-123', 'orca workflows status run-123 --wait']
  },
  {
    path: ['workflows', 'answer'],
    summary: 'Answer a pending workflow question',
    usage:
      'orca workflows answer <run-id> <question-id> (--option <id> | --text <answer>) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run-id', 'question-id', 'option', 'text'],
    positionalArgs: ['run-id', 'question-id'],
    examples: [
      'orca workflows answer run-123 question-1 --option approve',
      'orca workflows answer run-123 question-1 --text "Looks good"'
    ]
  },
  {
    path: ['workflows', 'send'],
    summary: 'Send a message to a running workflow node attempt',
    usage: 'orca workflows send <run-id> <attempt-id> --text <msg> [--interrupt] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run-id', 'attempt-id', 'text', 'interrupt'],
    positionalArgs: ['run-id', 'attempt-id'],
    examples: [
      'orca workflows send run-123 attempt-1 --text "Also check the changelog"',
      'orca workflows send run-123 attempt-1 --text "Stop and restart" --interrupt'
    ]
  },
  {
    path: ['workflows', 'pause'],
    summary: 'Pause a running workflow run',
    usage: 'orca workflows pause <run-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run-id'],
    positionalArgs: ['run-id'],
    examples: ['orca workflows pause run-123']
  },
  {
    path: ['workflows', 'resume'],
    summary: 'Resume a paused workflow run',
    usage: 'orca workflows resume <run-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run-id'],
    positionalArgs: ['run-id'],
    examples: ['orca workflows resume run-123']
  },
  {
    path: ['workflows', 'cancel'],
    summary: 'Cancel a workflow run',
    usage: 'orca workflows cancel <run-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run-id'],
    positionalArgs: ['run-id'],
    examples: ['orca workflows cancel run-123']
  },
  {
    path: ['workflows', 'rerun'],
    summary: 'Rerun a workflow from a given node',
    usage: 'orca workflows rerun <run-id> --from <node-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run-id', 'from'],
    positionalArgs: ['run-id'],
    examples: ['orca workflows rerun run-123 --from review-node']
  },
  {
    path: ['workflows', 'trust'],
    summary: 'Decide whether to trust a plugin skill source on a host',
    usage:
      'orca workflows trust <source> --decision trusted|refused [--host local|ssh:<id>|wsl:<distro>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'source', 'decision', 'host'],
    positionalArgs: ['source'],
    examples: [
      'orca workflows trust acme-decks@acme --decision trusted',
      'orca workflows trust acme-decks@acme --decision refused --host ssh:devbox'
    ]
  }
]
