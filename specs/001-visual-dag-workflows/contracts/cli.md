# Contract: `orca workflows` CLI group

Spec file `src/cli/specs/workflows.ts`, handlers `src/cli/handlers/workflows.ts`, lazy-loaded via
`handler-group-manifest.ts`. Every command accepts `--json` and the global flags.

| Command | Calls | Notes |
|---|---|---|
| `orca workflows list [--repo <selector>]` | `workflow.list` | defaults to the current repo |
| `orca workflows show <name>` | `workflow.read` | prints nodes, edges, roles, problems |
| `orca workflows validate <name>` | `workflow.validate` | exit 1 on errors |
| `orca workflows run <name> --objective <text> [--concurrency <n>]` | `workflow.run.start` | prints run id |
| `orca workflows runs [<name>] [--state <s>]` | `workflow.run.list` | |
| `orca workflows status <run-id> [--wait]` | `workflow.run.show`, `workflow.run.events` | `--wait` follows until terminal |
| `orca workflows answer <run-id> <question-id> (--option <id> \| --text <answer>)` | `workflow.run.answer` | |
| `orca workflows send <run-id> <attempt-id> --text <msg> [--interrupt]` | `workflow.run.sendMessage` | |
| `orca workflows pause|resume|cancel <run-id>` | matching run methods | |
| `orca workflows rerun <run-id> --from <node-id>` | `workflow.run.rerun` | |
| `orca workflows trust <source> --decision trusted\|refused` | `workflow.trust.decide` | |

Root help lines are added to `root-help-text-primary.ts` and names to `vocabulary-policy.ts`.
