# Research: Visual DAG Workflows

**Phase 0 output** for `plan.md`. Every unknown in the Technical Context is resolved here. Raw
findings with file paths are in `prior-art/codebase-internals/` (engine, renderer and RPC,
conventions) and `prior-art/` (external tools, upstream issues, Orca capabilities).

## R1. Engine placement and coordinator authority

- **Decision**: A deterministic `WorkflowEngine` runs inside the Orca runtime service
  (`src/main/runtime/workflows/`), on the host that owns the orchestration database. It owns one
  orchestration Run per workflow run. Authority is a new principal kind, `workflow-engine`, added
  to the existing caller resolution: the Run is bound with coordinator handle and pane key
  `workflow-engine:<workflowRunId>`, and `resolveOrchestrationCaller` / `resolveRunScope` accept
  an engine principal supplied by the engine itself instead of a terminal handle. Engine-owned
  Runs refuse terminal-originated mutations with a new error `workflow_owned_run`, so a CLI
  `run-use` cannot silently fence the engine.
- **Rationale**: Every orchestration verb resolves its Run from a live terminal pane
  (`run-scope.ts`, `workers.ts`), which is why the external orca-dag viewer has to occupy a
  terminal. Writing straight to `OrchestrationDb` would skip fencing, federation relay and
  `notifyMessageArrived`. A first-class principal keeps every handler-side guarantee and lets
  existing readers (`worker-list`, sidebar rows, orca-viz) see workflow Runs as ordinary Runs.
- **Alternatives considered**: (a) engine occupies a hidden terminal pane, as orca-dag does:
  fragile, visible in terminal lists, and the pane can be closed; (b) direct DB writes: skips
  guards and the federation relay; (c) run the engine as an LLM coordinator: rejected by
  accepted decision 1 and by upstream issue #15185.

## R2. Reacting to worker events without polling

- **Decision**: The engine holds one exclusive `runtime.waitForMessage('run:<id>')` loop per
  active workflow run, reading the mailbox backlog through `getOrCreateRunDelivery` before each
  wait so nothing is lost across restarts. On runtime start, active workflow runs are rehydrated
  from the `workflow_runs` table and their loops resumed.
- **Rationale**: `RuntimeMessageWaiters` is the only wake primitive and it is in-memory and
  exclusive per handle. Because engine-owned Runs refuse terminal callers (R1), no CLI
  `check --wait` can collide on the same handle.
- **Alternatives considered**: a 2-second poll like the legacy `Coordinator` (wasteful, and the
  spec requires under 5 seconds successor start); `agentSession.subscribeTurnCompletions` (live
  only, terminal workers not covered, carries no text).

## R3. Just-in-time Task creation and loop unrolling

- **Decision**: The engine creates an orchestration Task for a node only when that node becomes
  eligible, with `deps` set to the Tasks of its completed upstream nodes for the record. A Loop
  iteration creates fresh Tasks for its contained nodes, so the Run's Task graph is always
  acyclic and unrolled. New nullable columns `workflow_run_id`, `workflow_node_id` and
  `workflow_iteration` on `tasks` let external viewers group them.
- **Rationale**: `promoteReadyTasks` scans every pending Task across Runs and never cascades
  failure, and dependents of a failed Task stay pending forever. Owning the frontier in the
  engine avoids both, keeps Join and Skip semantics exact, and makes loops representable without
  changing the engine's acyclic invariant.
- **Alternatives considered**: pre-creating every Task at run start (breaks on loops and on
  skipped branches); a cycle-aware dependency model in the orchestration DB (a wire and
  semantics change for every existing reader).

## R4. Result contract capture

- **Decision**: Each Agent node's brief instructs the agent to write
  `.orca/workflow-runs/<runId>/<attemptId>/result.json` in the run workspace and to pass that
  path as `--report-path` on `worker_done`. The engine validates the file against the node's
  JSON Schema using Zod 4's `z.fromJSONSchema` and checks every declared artifact path exists.
  Absent or invalid results fail the node with the raw `worker_done` body and transcript kept.
  The `.orca` directory is already the per-user, auto-ignored convention.
- **Rationale**: No agent integration in Orca supports structured output (no schema support in
  `agentSession.*`, `worker_done` carries only prose plus `filesModified` and `reportPath`). A
  file is host-neutral, survives restarts, works for terminal and structured workers, and the
  existing `--report-path` field already carries it.
- **Alternatives considered**: scraping the last assistant message from `agentSession.history` or
  `workerRead` (unreliable, terminal-only output is not JSON); adding structured output to each
  agent adapter (per-provider work that upstream does not have).
- **Note**: `z.fromJSONSchema` is marked experimental by Zod; the engine wraps it in one module so
  it can be swapped for a JSON Schema validator without touching callers.

## R5. Agent brief and prompt budget

- **Decision**: The engine writes a full brief file
  `.orca/workflow-runs/<runId>/<attemptId>/brief.md` (role system prompt, node prompt with
  variables resolved, upstream results and artifact paths, skills to use, result contract and
  where to write it) and passes a short `taskSpec` that points at it. The spec stays inside
  `assertWorkerStartTaskSpecWithinPromptBudget`.
- **Rationale**: The preamble has no postamble hook; the only free text is `taskSpec`, which is
  budget-checked. A brief file also gives the run view something exact to show.
- **Alternatives considered**: extending `PreambleParams` (touches the worker contract every
  agent already follows); inlining everything into the spec (budget failures on real prompts).

## R6. Workflow file location and format

- **Decision**: Project workflows live in `orca-workflows/<name>.workflow.yaml` at the
  repository or folder root, tracked in version control. The directory is overridable through a
  new `workflows.directory` key in `orca.yaml`, and the committed source allowlist is
  `workflows.allowedSources` in the same file. Personal workflows live in
  `~/.orca/workflows/<name>.workflow.yaml`; a project file wins on a name clash. Format is YAML
  parsed with the `yaml` package already used for `orca.yaml`, with `version: 1` and canvas
  positions included. `workflows` is added to `RECOGNIZED_ORCA_YAML_KEYS`.
- **Rationale**: Orca auto-appends `.orca` to `.gitignore`, so `.orca/workflows/` (upstream
  issue #15012's proposal) would be silently untracked. `orca.yaml` is the only Orca-owned
  committed file and already carries directory-valued config (`worktree.sharedDirectories`).
- **Alternatives considered**: a `workflows:` array inside `orca.yaml` (one file for every
  workflow, poor diffs); a dotfolder (hidden from non-developer users); JSON (no comments).

## R7. Live run state to clients

- **Decision**: Invalidate-then-refetch, matching Automations: the host emits a
  `RuntimeClientEvent` `{ type: 'workflowRunChanged', runId, reason }` on the existing
  `runtime.clientEvents.subscribe` stream and a local IPC `workflows:changed`; clients refetch
  `workflow.run.show`. No new stream opcode.
- **Rationale**: New event types on the existing stream are dropped by old clients without harm
  (wire rule 1), whereas a new opcode needs capability negotiation (rule 2). The Automations page
  already proves the pattern end to end on local, SSH and paired remote hosts.
- **Alternatives considered**: a dedicated streaming method with deltas (more wire surface, no
  spec requirement for sub-second updates).

## R8. Human approvals, agent questions and follow-ups

- **Decision**: An Approval node creates a placeholder Task and a decision gate on it through
  the existing gate store; the engine treats gate resolution as the node's result and routes on
  the chosen option. Agent questions arrive as existing `question` messages in the Run mailbox;
  the engine stores them in `workflow_run_questions`, publishes them via the change event and a
  new notification source `workflow-attention`, and answers through `db.answerQuestion` with the
  engine's consumer generation. Timeouts and escalation are engine timers; on expiry the engine
  stops the worker and fails the node. Queued follow-ups use `orchestration.send` to
  `dispatch:<id>`; "interrupt now" uses `terminal.send` for terminal workers and
  `agentSession.send` for structured workers.
- **Rationale**: Gates, `ask`/`reply`, durable mail and terminal input already exist; only the
  surfaces are missing. `resolveGate` always readies the Task, so rejection routing must be an
  engine decision, which it is.
- **Alternatives considered**: a new question channel outside the mailbox (duplicates the store).

## R9. Skill provisioning

- **Decision**: Repository-sourced skills are installed at workspace scope by running the open
  agent skills CLI (`npx skills add <repo> --skill <name> --agent <provider> -y`) on the
  execution host through `runProcess` with the run workspace as working directory, after the
  source passes the project allowlist. This is the same command Orca's own CLI already uses for
  bundled skills. The engine records each installed path and adds it to the worktree's
  `.git/info/exclude` so it never shows as untracked, removing the entry on cleanup. Plugin-sourced
  skills are installed at host scope with the provider's own plugin command after the per-host
  trust decision; providers without a plugin CLI fail the node with instructions. Presence is
  verified with the existing Claude plugin scanner where it applies.
- **Rationale**: `skills.install` only accepts content-addressed packages (download grant,
  upload, local file), not a repository location. The skills CLI path is the existing precedent
  and works on every host Orca supports. Nothing in Orca writes `.git/info/exclude` today, and
  exact per-path entries avoid hiding committed skills such as `.claude/skills/speckit-*`.
- **Alternatives considered**: extending `skills.install` with a git ingress (larger change to
  the install transaction and receipts; can follow later); global installs only (violates
  accepted decision 10 and leaks skills across projects).

## R10. Canvas library

- **Decision**: `@xyflow/react` 12.11.6 (MIT, peer `react >=17`) with `@dagrejs/dagre` 3.1.1
  (MIT) for auto-layout. The library stylesheet is imported from the editor component, following
  the `pdf_viewer.css` and `xterm.css` precedents. Custom node and edge components use only
  `main.css` tokens.
- **Rationale**: Used by Dify, Langflow, Flowise, AutoGen Studio, orca-viz and orca-dag; React 19
  compatible; MIT. dagre is synchronous and sufficient for graphs of tens of nodes.
- **Alternatives considered**: Rete.js (heavier abstraction, smaller ecosystem); tldraw
  (commercial license); elkjs (needed only for compound layout, EPL, 1 MB, worker required).
- **Justified duplication**: React Flow bundles Zustand 4 internally while Orca uses Zustand 5.
  It is private to the library and does not touch Orca stores.

## R11. Renderer structure

- **Decision**: New `TopLevelView` id `workflows`, mounted like Automations (lazy page that owns
  its header), with a `showWorkflowsButton` sidebar setting and an `experimentalWorkflows`
  feature flag. Feature code lives in `src/renderer/src/components/workflows/` with a controller
  hook per surface; only `selectedWorkflowId`, `selectedWorkflowRunId` and
  `previousViewBeforeWorkflows` go in the global UI slice. Editor state is local to the page
  (React Flow state plus a reducer), persisted through the workflow RPC.
- **Rationale**: Matches the Automations page and the constitution's reuse rule; keeps the
  global store small.

## R12. Run workspace

- **Decision**: A run creates its workspace with the existing `worktree.create` (child of the
  project's default branch, named after the workflow and run id). Child-workspace nodes use
  `worker-start --worktree new-child`. Folder workspaces run in place, with child workspaces
  disabled and explained in the editor.
- **Rationale**: Reuses worktree creation, hooks, and SSH placement already in the runtime.

## R13. Mobile, notifications and CLI

- **Decision**: Mobile gets `workflow.run.list`, `workflow.run.show`, `workflow.run.answer` and
  `workflow.gate.resolve` on the allowlist, a pending-prompt card for workflow questions and
  approvals, and a run list. A new notification source `workflow-attention` is added to the
  mobile push sources. The CLI gains a `workflows` group (`list`, `show`, `run`, `runs`,
  `answer`, `cancel`) following the Automations shape.
- **Rationale**: FR-040 requires viewing and answering from mobile; the CLI is how headless
  hosts and other agents will start runs.

## R14. Compatibility gating

- **Decision**: One host capability `workflow.engine.v1` in `RUNTIME_CAPABILITIES`. Clients show
  the Workflows view for a paired environment only when the host advertises it. All new RPC
  params are optional beyond identifiers; no new stream opcode; the `TopLevelViewSchema` enum
  gains `workflows` via `openEnum` fallback so old hosts ignore it.
- **Rationale**: Wire rules 1 to 4 in `docs/reference/remote-wire-compatibility.md`.

## R15. Testing strategy

- **Decision**: Engine unit tests run against `new OrchestrationDb(':memory:')` and a fake
  runtime implementing the worker-start, message-waiter and terminal contracts. End-to-end runs
  use a stub agent: the launch command override points the `claude` agent at a script that reads
  the brief, writes `result.json` and sends `worker_done`, so a real Run executes with no model.
  Renderer tests use happy-dom and testing-library. UI validation uses the background Electron
  launch with CDP screenshots. Cross-version wire tests are unaffected because no opcode changes.
- **Rationale**: Constitution III; the stub agent makes loops, joins and gates deterministic.
