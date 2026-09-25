# Orca codebase report: what a visual agent-workflow editor can build on

KEY FINDING: Orca already has a multi-agent ORCHESTRATION engine (Runs, Tasks with dependencies, Dispatches, supervised workers, mailboxes, decision gates). It stores state in SQLite, is driven by the `orca orchestration ...` CLI and RPC, and is run by an agent following a bundled coordinator skill. There is no graph UI and no loop support. The natural design is a visual front end that compiles a graph into this engine.

## 1. Agent launch
- Agent list: `src/shared/tui-agent.ts`, type `TuiAgent` (39 IDs): claude, claude-agent-teams, openclaude, codex, autohand, opencode, opencode2, mimo-code, pi, omp, gemini, antigravity, aider, goose, amp, kilo, kiro, crush, aug, cline, codebuff, freebuff, command-code, continue, cursor, droid, kimi, mistral-vibe, qwen-code, rovo, hermes, openclaw, copilot, grok, devin, ante, trae, muse, prime-agent.
- Per-agent config registry: `src/shared/tui-agent-config.ts`, `TUI_AGENT_CONFIG: Record<TuiAgent, TuiAgentConfig>`. Fields:
  - detectCmd, launchCmd, launchCmdByPlatform, expectedProcess
  - promptInjectionMode ('argv'|'flag-prompt'|'flag-prompt-interactive'|'flag-interactive'|'hermes-query'|'stdin-after-start')
  - draftPromptFlag (e.g. claude `--prefill`), draftPromptEnvVar (e.g. pi `ORCA_PI_PREFILL`)
  - preflightTrust, draftPasteReadySignal, submitRetryDelayMs, Windows key encodings
- Launch command, args and env builders: `src/shared/tui-agent-launch-command.ts`, `tui-agent-startup.ts`, `tui-agent-startup-shell.ts`, `tui-agent-launch-defaults.ts`, `tui-agent-permissions.ts`, `tui-agent-launch-command-override.ts`.
- Launch request type: `src/shared/agent-launch-intent.ts`.
  - `AgentLaunchIntent { agent: TuiAgent; target: {kind:'existing',worktree} | {kind:'create-worktree',create}; prompt?: {text, delivery:'submit'|'draft'}; sessionOptions?; reuseTerminal?: {handle}; agentArgs?: string|null; cwd?; launchSource? }`.
  - The caller does not pick a mode. The host picks STRUCTURED (Claude via Agent SDK, Codex via app-server) or TERMINAL/PTY and reports it in `AgentLaunchOutcome` ({kind:'structured',sessionId,handle} | {kind:'terminal',handle,paneKey?}).
  - The prompt receipt is one of: journaled, handed-to-terminal, not-delivered.
- Executor: `src/main/agent-launch/agent-launch-executor.ts` (+ `agent-launch-mode.ts`, `agent-launch-prompt-delivery.ts`). Its header says only `agent.launch` uses it today; orchestration dispatch, mobile, CLI and desktop still launch their own way.
- RPC: `agent.launch`, `agent.launchReplay` in `src/main/runtime/rpc/methods/agent-launch.ts` (schemas in `agent-launch-schemas.ts`, `src/shared/rpc-contract/agent-launch-params.ts`).

## 2. Model and reasoning effort
- Catalog: `src/shared/agent-session-option-catalog.ts` (+ `-types.ts`, `-claude-codex.ts`, `-gemini-cursor.ts`, `-grok.ts`, `-muse.ts`, `-omp.ts`, `-antigravity.ts`).
  - Types: `AgentSessionOptionCatalog { models: CatalogModel[]; modelApply; supportsWorkerLaunchPreferences?; unknownModelOptions?; listModels?: {command, parse} }`, `CatalogModel { id, label, isDefault?, options: CatalogOption[] }`.
  - Agents with a catalog: antigravity, claude, codex, gemini, cursor, grok, muse, omp. All other agents have none.
- Flag mapping:
  - Claude: `--model <id>`, `--effort low|medium|high|xhigh|max` (per-model levels come from a `claude` model-list probe). Mid-session change via `/effort <v>`.
  - Codex: `-m <id>`, `-c model_reasoning_effort=<v>` (choices capped per model). An existing `--reasoning-effort` in the args is detected and removed.
- Resolving to argv: `src/shared/agent-session-option-launch.ts` (`resolveAgentSessionOptionLaunch`, `removeOverriddenAgentSessionArgs`). Model discovery: `src/shared/agent-model-probe-spec.ts`.
- Orchestration workers: `worker-start --model <id> --effort <level>`, params at `src/shared/rpc-contract/orchestration-worker-start-params.ts:30-31`.
  - Supported: Claude, Codex, Cursor, Antigravity, Muse. opencode and others reject `--model`.
  - `--effort` requires `--model`; neither combines with `--terminal`.
  - The receipt reports `launch.requested` vs `launch.effective`. Federated hosts must advertise launch-preference support.
- UI: `src/renderer/src/components/agent/AgentCombobox.tsx`, `AgentSettingsDialog.tsx`; new-workspace agent picker in `components/new-workspace/NewWorkspaceComposerAgentSection.tsx`. Native-chat session options use the same catalog (`agentSession.options`, `agentSession.setOption`).

## 3. Parallel fan-out
- There is NO dedicated fan-out-and-compare code. The README claim ("Fan one prompt across five agents... merge the winner") is a MANUAL recipe in `docs/site/content/docs/recipes/parallel-agents.mdx`: create 3 worktrees, launch different agents, paste the same prompt, split panes, review diffs, delete the losers. I found no compare or merge-winner UI.
- Worktree API: RPC `worktree.create`, params in `src/shared/rpc-contract/worktree-create-params.ts`: repo, name, baseBranch, compareBaseRef, branchNameOverride, linkedIssue, linkedPR, linkedLinearIssue, linkedGitLabMR/Issue, linkedBitbucketPR, linkedAzureDevOpsPR, linkedGiteaPR, linkedWorkItem, linkedTaskSourceContext, comment, displayName, sparseCheckout, pushTarget, runHooks, activate, parentWorktree, noParent, and more. Handler in `src/main/runtime/rpc/methods/worktree.ts:76`, args in `worktree-create-args.ts`.
- Folder workspaces (no git): `folderWorkspace.list/create/update/delete/getPathStatus` in `src/main/runtime/rpc/methods/folder-workspace.ts`.
- CLI: `orca worktree create --name <n> [--repo|--project [--host]|--project-host-setup] [--agent <id>] [--prompt <text>] [--setup run|skip|inherit] [--base-branch] [--issue <n>] [--linear-issue <id|url>] [--comment] [--parent-worktree|--no-parent] [--run-hooks] [--activate] [--json]` (`src/cli/specs/core.ts:93`).
- Programmatic fan-out already exists: `orca orchestration worker-start --worktree new-child|new-top-level --name ... --agent ...` creates the worktree and launches the agent in one call.

## 4. Skills
- A skill is a directory with SKILL.md. Type: `DiscoveredSkill { id, name, description, providers, sourceKind, rootPath, directoryPath, skillFilePath, installed, updatedAt }` in `src/shared/skills.ts`.
- Provider paths (`docs/reference/agent-skill-provider-paths.md`; only Codex and Claude Code are registered):
  - Codex: `$HOME/.agents/skills` and workspace `.agents/skills`.
  - Claude: `$HOME/.claude/skills` and `.claude/skills`. Orca links these to the canonical copy by symlink, junction or verified copy.
- Engine: `src/main/skills/*` (install, update, remove transactions, SSH relay, WSL, cloud sharing). Other paths: `skill-provider-destinations.ts`, `skill-install-destinations.ts`, `agent-skill-selection.ts`.
- RPC: `skills.discover/install/installBundle/share/delete/previewInstall/removeInstall/listManagedInstalls/...` in `src/main/runtime/rpc/methods/skills.ts`. CLI: `orca skills get|install|installed|list|share|update`. UI: top-level view `'skills'` (`components/skills/SkillsPage`).
- Bundled skills: `skills/` (computer-use, linear-tickets, orca-cli, orca-emulator, orca-emulator-android, orca-linear, orca-per-workspace-env, orchestration); full guides in `skill-guides/`, stubs in `skill-stubs/`, manifests in `resources/skills/`. The bundled guides are served by `orca skills get <name>` (`src/cli/bundled-skill-guides.ts`).
- A launch CANNOT choose skills. There is no skills field in AgentLaunchIntent or in the worker-start params. Skills are on-disk per workspace or global. Per-node skills would need a new mechanism, e.g. placing into the node worktree's `.claude/skills` or `.agents/skills` before launch.

## 5. Agent status and hook server
- Rule (`docs/reference/agent-status-store.md`): the execution host owns agent status in ONE store, the hook server's (`src/main/agent-hooks/server.ts`). Every reader (sidebar, `worktree ps`, mobile, dashboard) subscribes to it; precedence is decided once, at write time.
  - Inputs: agent hook HTTP posts, WSL/SSH relay receivers, main's OSC terminal parse, and structured-session summaries. All go through `applyNormalizedStatus`.
  - Persisted to `last-status.json` (7-day hydrate, `restoredUnconfirmed`). Structured rows are never persisted.
  - Renderer receives IPC `agentStatus:set`, `agentStatus:clear`, `agentStatus:getSnapshot`.
- States: `AGENT_STATUS_STATES = ['working','blocked','waiting','done']` (`src/shared/agent-status-types.ts:26`). The subagent state adds 'idle' and 'unverifiable'.
- Row flags and fields: workingMode 'monitoring'; interrupted; sessionBoundary (a done that is NOT a completed turn; completion consumers must ignore it); lastAssistantMessage; subagents; providerSession; orchestration {taskId, dispatchId, dispatchStatus, coordinatorHandle, orchestrationRunId, attention}.
- Observing "agent finished":
  - (a) orchestration `worker_done` message (with `--outcome succeeded|failed`), read via `orchestration check --wait --types worker_done,escalation,question`
  - (b) `terminal.wait` with condition `'exit' | 'tui-idle'` (`src/shared/runtime-terminal-contracts.ts:333`)
  - (c) structured sessions: `agentSession.subscribeTurnCompletions` and `agentSession.subscribeStatus`
- Reading an agent's output:
  - `orchestration worker-read --dispatch <id> --source auto|transcript|terminal` (`src/main/runtime/orchestration/worker-transcript-*.ts`, `worker-output-archive.ts`)
  - `terminal.read`
  - `agentSession.history`
- Session search: `aiVault.searchSessions`, per execution host (`local | ssh:<target> | runtime:<envId>`) (`docs/reference/agent-session-search-contract.md`, `src/shared/ai-vault-search-types.ts`).
- Structured session RPCs: `agentSession.create/createSupport/ensure/send/cancel/close/history/options/setOption/respondToApproval/respondToQuestion/rewind/hold/release/subscribe/subscribeStatus/subscribeTurnCompletions/restart*/requestHandoff/reveal`, plus `terminal.createAgentSession` and `terminal.ensureAgentSession`.

## 6. Sending input to agents
- `terminal.send` (`src/main/runtime/rpc/methods/terminal/terminal-send-method.ts`): text, enter, interrupt, agentPrompt, requireAgentStatus, inputKind. CLI: `orca terminal send`.
- `agentSession.send` for structured sessions.
- Orchestration: `orchestration.send`, `reply`, `ask`, plus `orchestration.workerTerminalUserInput`. Mail is durable; the terminal "pointer" nudge is best effort (`src/main/runtime/orchestration/mailbox-pointer-*.ts`).
- Mobile follow-ups use the same RPCs: `mobile/src/session/mobile-structured-agent-session-send.ts`, `mobile-session-write-operations.ts`, `mobile/src/terminal/mobile-terminal-operations.ts`.

## 7. RPC / runtime layer
- Method families in `src/main/runtime/rpc/methods/`:
  - Agents and orchestration: agent-launch, agent-session, structured-agent-session*, agent-hooks, orchestration/{runs, worker, messaging, gates, federation}, session-tabs, terminal/, native-chat
  - Workspaces, files, git: worktree, worktree-catalog, folder-workspace, repo, files*, git, git-diff, workspace-ports, project-runtime
  - Integrations: github (issues, PRs, projects, work items), gitlab, jira, linear*, hosted-review
  - Automations, skills, artifacts: automations, skills, artifacts, ai-vault
  - Browser and devices: browser*, computer, emulator, clipboard, speech
  - Client and app: accounts, client-ui, client-settings, client-events, notifications, pairing, mobile-web-bundle, plugins, preflight, host-capabilities, runtime-client-capabilities, ssh, stats, status, diagnostics, updater
- SSH boundary (`docs/reference/ssh-execution-boundary.md`):
  - PTYs, agent CLIs, git, filesystem and setup hooks run on the REMOTE host.
  - Orchestration state (Runs, Tasks, Dispatches, mailboxes) is CLIENT-resident. The `orca` shim on the SSH host proxies back to the client, so orca commands fail while the client is disconnected even though the PTY stays live.
  - Verdict vocabulary: live / unverifiable / exited.
  - Federation (`orchestration/federation/*`, `--on <saved-environment>`) places workers on paired runtimes.
  - A workflow engine should therefore run where the orchestration DB lives (the client/runtime owning the Run) and dispatch agents to the execution host.

## Addendum (verified directly by lead)
- Bundled coordinator skill: `skills/orchestration/SKILL.md`, guide `skill-guides/orchestration.md`, references in `skill-guides/orchestration/references/` (coordinator-loop, messaging-and-gates, recovery-and-cleanup, placement-and-remote, worker-contract, low-level-topology, legacy-contract-migration).
- Engine vocabulary: Run (durable namespace + coordinator inbox), Task (work, with `--deps`), Dispatch (one authoritative attempt), worker (supervised terminal), mailbox (durable FIFO, `check --wait --types worker_done,escalation,question`), gate (`gate-create --task --question --options`, `gate-resolve`), ask/reply.
- Loop primitive today: retry of a known Task = `worker-start --task <task_id> --retry-of <dispatch_id>`; only after a positively proven failed/stopped attempt. No declarative cycle; the coordinator agent decides.
- Depth limit for nested workers; guide recommends parallel waves over chains deeper than 3-4.
- Model/effort per worker: `worker-start --model <id> --effort <level>` (claude, codex, cursor, antigravity, muse only). Receipt has launch.requested vs launch.effective.
- Real catalog ids: Codex `gpt-5.6-sol|gpt-5.6-terra` (effort up to `ultra`), `gpt-5.6-luna` (max), `gpt-5.5` (xhigh), `gpt-5.2-codex`; Claude `fable|opus|sonnet|haiku` with effort `low|medium|high|xhigh|max`; Codex effort includes `minimal`.
- Coordinator is an LLM agent following the skill; it is not a deterministic engine. Review ownership rule: a review-only worker_done authorizes synthesis, not coordinator edits; fixes go back to the owner.
- Automations (`automation.list/show/create/update/runs`, `src/shared/automation-*.ts`): cron-style schedules that launch an agent on a pinned execution host (`automation-execution-target.ts`, `automation-workspace-pin.ts`) with run history/retention. Candidate trigger source for a workflow run; not itself a DAG.

## 8. Existing orchestration engine
- Model (types in `src/main/runtime/orchestration/types.ts`):
  - RUN: durable namespace plus coordinator inbox; it does not schedule or place workers. RunRow: id, objective, home_database, coordinator_handle, coordinator_pane_key, consumer_generation.
  - TASK: spec, parent_id, deps (JSON array of task IDs), result. TaskStatus: pending|ready|dispatched|completed|failed|blocked.
  - DISPATCH: one authoritative attempt of a task on a terminal. DispatchStatus: pending|dispatched|completed|failed|circuit_broken.
  - WORKER: a supervised agent terminal or structured session started by `worker-start`. It receives an injected preamble (`preamble.ts`) with the Task ID, Dispatch ID and CLI commands. Worker terminal states: active|reclaimable|retained|release_pending|release_unknown|released.
  - MAILBOX / MESSAGE: types status, dispatch, worker_done, merge_ready, escalation, handoff, decision_gate, question, heartbeat. Priority normal|high|urgent. Deliveries are FIFO batches (outstanding|acknowledged|fenced) that must be acked.
  - DECISION GATE: a coordinator-owned question that blocks a Task until resolved (pending|resolved|timeout).
- Storage: SQLite via `node:sqlite` (`src/main/sqlite/sync-database.ts`) at `userData/orchestration.db`, opened in `src/main/runtime/orca-runtime-automation-operations.ts:153` (`getOrchestrationDb`). DB layer `src/main/runtime/orchestration/db/*`. Schema (tables messages, tasks, dispatch_contexts, decision_gates, coordinator_runs) visible in `src/main/runtime/orchestration/db.test.ts:721-775`.
- DAG and coordinator logic: `coordinator-dag-convergence.ts`, `coordinator-decision-gates.ts`, `coordinator-task-dispatch.ts` (circuit breaker -> circuit_broken), `coordinator-escalation-triage.ts`, `task-deps-flag.ts`, `lifecycle-reconciliation.ts`, `worker-report-observation.ts`.
  - Nesting depth limit: `src/shared/nested-worker-depth.ts`, setting `nestedWorkerMaxDepth`.
  - OLD in-process `Coordinator` class (`coordinator.ts`, phases decomposing->dispatching->monitoring->merging->done, maxConcurrent 4) is RETIRED: `coordinator-start/stop` and `run/run-stop` perform no effects (`docs/site/content/docs/cli/orchestration.mdx`). Today the coordinator is an AGENT running the skill's loop.
- RPC (`src/main/runtime/rpc/methods/orchestration*`, params in `src/shared/rpc-contract/orchestration-*-params.ts`): runCreate/List/Show/Use/Current, run, runStop; taskCreate/List/Update, dispatch, dispatchShow; workerStart/List/Show/Read/Stop/Abandon/Release/Retain, workerTerminalUserInput; send, check, inbox, ask, reply; gateCreate/List/Resolve; reset, requestShow; federationAttachStart/Read/ReadOutput/Show/Stop/Release/Import/Pull/Ack/FleetSnapshot.
- CLI (`src/cli/specs/orchestration.ts`, `orchestration-worker-specs.ts`; handlers `src/cli/handlers/orchestration*`): run-create/list/show/use/current; task-create (--spec --deps --parent --task-title), task-list (--ready --brief), task-update, dispatch, dispatch-show; worker-start/list/show/read/stop/abandon/release/retain; send, check (--wait --types --ack --timeout-ms), inbox, ask, reply; gate-create (--task --question --options), gate-list, gate-resolve; request-show, reset.
  - worker-start usage: `(--task|--spec) [--on <env>] [--worktree current|selector|new-child|new-top-level] (--agent|--terminal) [--task-title] [--deps] [--parent] [--model] [--effort] [--name] [--repo] [--base-branch] [--display-name] [--comment] [--setup run|skip|inherit] [--retry-of] [--timeout-ms] [--run] [--json]`
- Experimental setting: docs say "Enable orchestration under Settings -> Experimental" (`docs/site/content/docs/cli/orchestration.mdx`). UI `src/renderer/src/components/settings/OrchestrationPane.tsx`, `OrchestrationSetupCard.tsx`, mounted from `settings-capability-section-renderers.tsx:80`. Only confirmed key: `nestedWorkerMaxDepth`. No boolean `*orchestration*Enabled` found in `src/shared/global-settings-types.ts`; "setup" may be skill install. Feature ids `agent-orchestration-setup`, `agent-orchestration` (`src/shared/feature-interaction-catalog.ts:104-107`).
- LOOPS: task deps are an acyclic list; no cycle detection or support. A QA->dev loop must be new Tasks per iteration, or reuse the same terminal with `worker-start --task <next> --terminal <handle>`.
- Other: Claude Agent Teams launch mode (`src/main/runtime/claude-agent-teams-*.ts`, `orca claude-teams`); Automations (scheduled or task-source triggered prompt+agentId, headless dispatch: `src/main/automations/*`, `src/shared/rpc-contract/automation-params.ts`); dashboard orchestration rows (`components/dashboard/dashboard-orchestration-selection.ts`, `components/sidebar/worktree-agent-row-orchestration.ts`); `.claude/skills/` holds only speckit-*.

## 9. Renderer structure
- Top-level views: `TopLevelView` in `src/shared/ui-chrome-types.ts:113` = 'terminal'|'settings'|'tasks'|'activity'|'automations'|'space'|'skills'|'artifacts'|'mobile'. Lazy-mounted in `src/renderer/src/app-shell/AppWorkspaceShell.tsx:15-27,71-85`. Nav `components/sidebar/SidebarNav.tsx`; actions `store/slices/ui/ui-slice-view-actions.ts`. Persisted `PersistedUIState.activeView` (`src/shared/persisted-ui-state-types.ts:33`); unknown view falls back to 'terminal'. A full-screen editor = new TopLevelView + lazy page.
- In-workspace tabs: `TabContentType` (`src/shared/tab-types.ts:20`) = terminal|editor|diff|conflict-review|check-details|agent-session|browser|simulator. State in `store/slices/tabs*.ts`, `tab-group-state.ts`.
- State: Zustand ^5 (`src/renderer/src/store/index.ts`, slices in `store/slices/`).
- Graph libraries: NONE (no xyflow/reactflow, dagre, elkjs, d3, konva, pixi, cytoscape). Present: `mermaid` ^11 (markdown only), `@dnd-kit/core`. zod ~4.5.
- Design system: `docs/STYLEGUIDE.md`, tokens `src/renderer/src/assets/main.css`, primitives `src/renderer/src/components/ui/`.

## 10. Persistence
- App state: JSON `orca-data.json` under `userData/profiles/...` (`src/main/orca-profiles/profile-storage-paths.ts`, `src/main/persistence.ts` + `src/main/persistence/*`). No electron-store.
- SQLite: orchestration.db, session-search index (`src/main/ai-vault-search/`). Agent status: `last-status.json`.
- In repo: `orca.yaml` at repo root is the tracked project config (parser `src/shared/orca-yaml.ts`: scripts.setup/archive, issueCommand, defaultTabs, VM recipes). Unknown top-level keys detected (`src/main/hooks.ts:150`).
- Per-user repo override dir: `<repo>/.orca/`, e.g. `.orca/issue-command` (`src/main/issue-command-file.ts:11`). Per-user home: `~/.orca/keybindings.json`.
- Shareable workflow definition fits as a tracked file (orca.yaml key or committed file); personal in `.orca/` or app data. Remote repos must be read on the execution host.

## 11. CLI
- Specs `src/cli/specs/*.ts`, handlers `src/cli/handlers/`. Groups: status, open, serve, agent-context, claude-teams; worktree create|list|ps|rm|set|show|current; repo ...; project ...; terminal create|list|read|send|wait|split|stop|close|rename|show|switch; orchestration (see 8); automations create|edit|list|run|runs|show|remove; skills get|install|installed|list|share|update; linear; browser, computer, emulator; agent hooks on|off|status|prepare-codex; environment; host; account; artifacts; vm recipe doctor; diagnostics memory.
- Headless: `orca orchestration run-create` -> `task-create --deps` -> `worker-start ... --json` -> `check --wait`, or `orca automations run`. Requires a running Orca runtime (`orca status`; headless Linux: `docs/reference/headless-linux-server.md`, `orca serve`). On Linux use `orca-ide` or `ORCA_CLI_COMMAND`.

## 12. Starting from a task (GitHub / Linear / Jira / GitLab)
- Tasks top-level view (`components/task-page/*`, `use-task-page-composer-actions.ts`) builds `linkedWorkItem` and opens `NewWorkspaceComposerCard.tsx` -> `worktree.create` with linkedIssue, linkedLinearIssue, linkedWorkItem, linkedTaskSourceContext.
- CLI: `worktree create --issue <n> | --linear-issue <id>`. Automations accept `task-source` triggers for github, gitlab, linear, jira (`automation-params.ts:110`). `issueCommand` in orca.yaml / `.orca/issue-command` sets the default prompt from an issue.

## Hard constraints the spec must respect
1. SSH: execution host owns agents, git, filesystem. Never fall back to local. Contact loss = `unverifiable`. Orchestration state is client-resident, so remote steps stall while the client is disconnected.
2. Folder workspaces: nodes and workflows must work without git or worktrees.
3. Agent status single owner: node state from the hook-server store or orchestration worker_done; no new producer, cache or reader-side precedence. Ignore `sessionBoundary` done rows.
4. Remote wire compatibility: new RPC fields optional; new stream opcodes capability-negotiated; model/effort forwarded only when the worker host advertises support.
5. Git 2.25 baseline; provider-neutral naming (GitHub, GitLab, Bitbucket, Azure DevOps, Gitea, Linear, Jira).
6. Cross-platform: runProcess/spawnProcess, buildWslExecArgs, CmdOrCtrl, path.join.
7. Agent screen rules need captured PTY transcripts.
8. Engine limits: orchestration Experimental; deps acyclic; model/effort only claude/codex/cursor/antigravity/muse; no per-launch skill selection (skills on-disk; only Codex and Claude have registered paths); nested-worker depth cap; prefer shallow waves.
9. UI: STYLEGUIDE + shadcn primitives. No graph library present: adding one is a new-dependency decision (constitution: justify).
10. Code style: no max-lines disables; no vague file names; .ts over .d.ts; SAFETY comments on casts.
