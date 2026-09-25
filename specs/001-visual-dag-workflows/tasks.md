---

description: "Task list for Visual DAG Workflows"
---

# Tasks: Visual DAG Workflows

**Input**: Design documents from `/specs/001-visual-dag-workflows/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R15), data-model.md, contracts/ (workflow-file, rpc-methods, cli, agent-brief), quickstart.md

**Tests**: REQUIRED. The constitution (Principle III) requires new standalone tests for every feature and forbids breaking existing tests. Test tasks in each phase are written first and must fail before the implementation task that makes them pass (Superpowers TDD).

**Organization**: Grouped by user story. Every phase is an independently testable increment. Every new `.ts` file stays under 300 lines and every `.tsx` under 400 (max-lines ratchet, no disables); split rather than grow.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US8)
- Include exact file paths in descriptions

## Path Conventions

Monorepo per plan.md: shared types `src/shared/workflows/`, engine `src/main/runtime/workflows/`, RPC `src/main/runtime/rpc/methods/workflows/`, renderer `src/renderer/src/components/workflows/`, CLI `src/cli/`, mobile `mobile/src/workflows/`, fixtures `tests/fixtures/workflows/`, scripts `config/scripts/`.

## Global rules for every task

- Modules under `src/main/runtime/` MUST NOT import `electron` (runtime-electron ratchet).
- Modules under `src/shared/` that mobile imports MUST NOT import `node:*` or `electron`.
- Child processes go through `runProcess`/`spawnProcess` from `src/shared/child-process/`.
- Casts other than `as const` carry a line-specific `SAFETY:` comment.
- UI uses `main.css` tokens and `components/ui/` primitives only; strings go through `translate()` and `pnpm run sync:localization-catalog`.
- Liveness vocabulary is exactly `live` / `unverifiable` / `exited`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, fixtures, flags and the stub agent every later phase relies on.

- [ ] T001 Add `@xyflow/react@12.11.6` and `@dagrejs/dagre@3.1.1` to `package.json` dependencies with `pnpm add`, record the justified Zustand 4 duplication (research R10) in `docs/reference/visual-dag-workflows.md` (create with a "Dependencies" section only)
- [ ] T002 [P] Add `WORKFLOW_ENGINE_RUNTIME_CAPABILITY = 'workflow.engine.v1'` to `src/shared/protocol-version.ts` and append it to `RUNTIME_CAPABILITIES`
- [ ] T003 [P] Add `experimentalWorkflows: boolean` (default `false`) and `showWorkflowsButton: boolean` (default `true`) to `src/shared/global-settings-types.ts` and `src/shared/default-global-settings.ts`, and expose both in `src/main/ipc/settings.ts` following `showAutomationsButton`
- [ ] T004 [P] Create the sample repository fixture `tests/fixtures/workflows/sample-repo/` (README.md, `orca.yaml` with `workflows.allowedSources: [https://github.com/github/spec-kit]`, an empty `orca-workflows/` directory) and a helper `tests/fixtures/workflows/create-sample-repo.ts` that copies it into a temp git repo with one commit
- [ ] T005 [P] Copy the example from `specs/001-visual-dag-workflows/contracts/workflow-file.md` to `tests/fixtures/workflows/feature-with-qa.workflow.yaml` and add `tests/fixtures/workflows/two-node.workflow.yaml` (start → implement → review → end, no loop)
- [ ] T006 [P] Create the deterministic stub agent `config/scripts/workflow-stub-agent.mjs`: reads the brief path from its argv/stdin, looks up a scripted response table in `WORKFLOW_STUB_SCRIPT` (JSON env var keyed by node id and iteration), writes `result.json`, then runs `orca orchestration send --type worker_done --report-path <result.json> --outcome <succeeded|failed>` using the `ORCA` executable from env; document its protocol in a header comment
- [ ] T007 [P] Add `tests/fixtures/workflows/stub-agent-launch-override.ts` that returns launch command overrides mapping `claude` and `codex` to the stub agent, using the shape accepted by `src/shared/tui-agent-launch-command-override.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared definition model, persistence, engine authority, file store, RPC family skeleton, and view registration. No user story can start before this phase completes.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Shared definition model

- [ ] T008 [P] Write `src/shared/workflows/workflow-definition-types.test.ts` asserting the discriminated `Node` union covers exactly `start|end|agent|router|loop|join|approval|reflection` and that `Condition` accepts `all|any|not` nesting
- [ ] T009 [P] Create `src/shared/workflows/workflow-definition-types.ts` with `Workflow`, `Role`, `SkillReference` (`source: {kind:'plugin', plugin} | {kind:'repository', location, version?}`, `required` default true), `NodeBase`, all eight node types, `Edge` (`fromPort?`, `condition?`), `Condition`, and `Layout` exactly as in data-model.md section 1
- [ ] T010 [P] Write `src/shared/workflows/workflow-definition-schema.test.ts` covering: `version` required, unknown `version` rejected with `workflow_file_version_unsupported`, Loop without `maxIterations` rejected, `maxIterations >= 1`, Join quorum must be a positive integer, unknown keys preserved as warnings
- [ ] T011 Create `src/shared/workflows/workflow-definition-schema.ts` (zod, strict on known objects, `version: z.literal(1)`) plus `parseWorkflowDefinition(raw: unknown): { definition, problems }` and `upgradeWorkflowDefinition()` (no-op for v1)
- [ ] T012 [P] Write `src/shared/workflows/workflow-graph-validation.test.ts` for every rule in data-model.md "Graph validation rules": one Start, ≥1 End, reachability, cycle outside a Loop body rejected with the offending edge id, Loop entry/exit inside body, Join ≥2 incoming and quorum ≤ incoming, Approval/Router one edge per option, model override on agent without catalog rejected, unknown roleId, child workspace disallowed under `in-place`
- [ ] T013 Create `src/shared/workflows/workflow-graph-validation.ts` exporting `validateWorkflowGraph(definition, context: { agentSupportsModel(agent): boolean; allowlistedSources: string[] }): Problem[]` with `Problem = { code, message, nodeId?, edgeId?, roleId?, severity }`; split cycle detection into `src/shared/workflows/workflow-graph-cycles.ts`
- [ ] T014 [P] Write `src/shared/workflows/workflow-condition-evaluation.test.ts` for every `op` (`eq neq gt gte lt lte truthy falsy contains lengthGt`) and nested `all/any/not`, including missing paths evaluating to false
- [ ] T015 [P] Create `src/shared/workflows/workflow-condition-evaluation.ts` exporting `evaluateCondition(condition, value: unknown): boolean` with dot-path lookup
- [ ] T016 [P] Create `src/shared/workflows/workflow-node-states.ts` with `WORKFLOW_RUN_STATES = ['queued','running','paused','waiting','completed','failed','cancelled']`, `WORKFLOW_ATTEMPT_STATES = ['pending','provisioning','running','waiting','completed','failed','skipped','cancelled','unverifiable']`, and `canTransition(kind, from, to)` per data-model.md section 4; test in `workflow-node-states.test.ts`
- [ ] T017 [P] Create `src/shared/workflows/workflow-run-types.ts` with `RunSummary`, `RunSnapshot`, `NodeAttemptView`, `RunQuestionView`, `RunMessageView`, `RunEventView` mirroring the `workflow_*` tables in data-model.md section 3 (camelCase, ISO timestamps)
- [ ] T018 [P] Write `src/shared/workflows/workflow-brief-references.test.ts` for `${objective}`, `${upstream.<node>.result.<path>}`, `${upstream.<node>.artifacts}`, `${loop.previous.<node>.result.<path>}`, `${join.branches}`, and an unresolved reference producing a Problem
- [ ] T019 Create `src/shared/workflows/workflow-brief-references.ts` exporting `resolveBriefReferences(text, inputs): { text, problems }`

### Persistence (orchestration.db v41 → v42)

- [ ] T020 Write `src/main/runtime/orchestration/db/schema/migrate-v42.test.ts`: fresh DB reaches version 42, a v41 DB gains every new table and the nullable columns `tasks.workflow_run_id`, `tasks.workflow_node_id`, `tasks.workflow_iteration`, `runs.workflow_run_id`, and migration is idempotent
- [ ] T021 Create `src/main/runtime/orchestration/db/schema/migrate-v42.ts` adding tables `workflow_runs`, `workflow_node_attempts`, `workflow_run_events`, `workflow_run_questions`, `workflow_run_messages`, `workflow_source_trust`, `workflow_role_proposals` with the columns and CHECK constraints from data-model.md section 3, and the four nullable columns; bump `SCHEMA_VERSION` to 42 in `db/contract-constants.ts`; register in `db/schema/migrate.ts`
- [ ] T022 Add the new columns to `VERSIONED_POST_V6_COLUMNS` in `src/main/runtime/orchestration/db/orchestration-schema-version-skew.ts` and to `TASK_COLUMNS`/`RUN_COLUMNS` in `db/row-column-lists.ts`; extend `src/main/runtime/orchestration/db/orchestration-version-skew-migration.test.ts` for the new columns
- [ ] T023 [P] Write `src/main/runtime/orchestration/db/workflow-runs/workflow-run-store.test.ts` (in-memory DB): create run, transition state with `canTransition` enforcement, list by repo/name/state with cursor paging, show
- [ ] T024 [P] Create `src/main/runtime/orchestration/db/workflow-runs/workflow-run-store.ts` mixin: `createWorkflowRun`, `getWorkflowRun`, `listWorkflowRuns({repoId?, name?, state?, cursor?, limit})`, `transitionWorkflowRun(id, state)`, `listActiveWorkflowRuns()`
- [ ] T025 [P] Write `src/main/runtime/orchestration/db/workflow-runs/workflow-attempt-store.test.ts`: create attempt, set task/dispatch ids, transition with enforcement, record launch receipt, record result and artifacts, list by run
- [ ] T026 [P] Create `src/main/runtime/orchestration/db/workflow-runs/workflow-attempt-store.ts` mixin: `createWorkflowAttempt`, `updateWorkflowAttempt`, `transitionWorkflowAttempt`, `listWorkflowAttempts(runId)`, `findWorkflowAttemptByTask(taskId)`
- [ ] T027 [P] Create `src/main/runtime/orchestration/db/workflow-runs/workflow-event-store.ts` (`appendWorkflowEvent`, `listWorkflowEvents(runId, afterSeq, limit)`) with test `workflow-event-store.test.ts`
- [ ] T028 [P] Create `src/main/runtime/orchestration/db/workflow-runs/workflow-question-store.ts` and `workflow-message-store.ts` (create, list pending, answer/deliver transitions, expiry lookup) with tests `workflow-question-store.test.ts` and `workflow-message-store.test.ts`
- [ ] T029 [P] Create `src/main/runtime/orchestration/db/workflow-runs/workflow-trust-store.ts` (`getSourceTrust`, `setSourceTrust`, `listSourceTrust`) with test
- [ ] T030 Attach the workflow mixins to `OrchestrationDb` in `src/main/runtime/orchestration/db.ts` and add a regression test in `src/main/runtime/orchestration/db.test.ts` that existing Task/Dispatch tests still pass with the new columns present

### Engine principal (coordinator authority, research R1)

- [ ] T031 Write `src/main/runtime/rpc/methods/orchestration/runs/run-scope.test.ts` additions: a `workflow-engine` principal resolves its own Run; a terminal caller mutating an engine-owned Run (runs.workflow_run_id set) is refused with `workflow_owned_run`; existing terminal behaviour unchanged
- [ ] T032 Create `src/main/runtime/workflows/workflow-engine-principal.ts` exporting `OrchestrationPrincipal = { kind: 'terminal'; handle } | { kind: 'workflow-engine'; workflowRunId }` and `engineCoordinatorHandle(workflowRunId)` / `engineCoordinatorPaneKey(workflowRunId)` returning `workflow-engine:<id>`
- [ ] T033 Extend `resolveOrchestrationCaller` and `resolveRunScope` (`src/main/runtime/rpc/methods/orchestration/runs/run-scope.ts` and its caller-resolution module) to accept an optional `principal` in `RpcContext` (set only by in-process engine calls), map an engine principal to its bound Run via `runs.workflow_run_id`, and refuse terminal callers on engine-owned Runs with `workflow_owned_run`
- [ ] T034 Extend `src/main/runtime/rpc/methods/orchestration/worker/workers.ts` and `worker/local-worker-start.ts` so an engine principal supplies an explicit `worktreeId` placement and creator identity instead of `resolveDispatchCallerWorktreeId(runtime, from)`; add `workers.engine-principal.test.ts` covering local start with model/effort and refusal of `--terminal` reuse
- [ ] T035 Create `src/main/runtime/workflows/workflow-orchestration-client.ts`: a thin in-process caller that dispatches `orchestration.*` methods through `RpcDispatcher` with `clientKind: 'runtime'`, the engine principal in context, and a fresh `orchestrationRequestId` per mutation; test `workflow-orchestration-client.test.ts` verifies request ids are unique and the principal is passed

### Workflow file store and project config

- [ ] T036 [P] Add `workflows` to `RECOGNIZED_ORCA_YAML_KEYS` in `src/main/hooks.ts` and parse `workflows.directory` (default `orca-workflows`) and `workflows.allowedSources: string[]` in `src/shared/orca-yaml.ts`; extend `src/shared/orca-yaml.test.ts` for both keys and for an invalid `allowedSources` entry
- [ ] T037 [P] Write `src/main/runtime/workflows/workflow-file-store.test.ts`: list project and personal files, project wins on clash, read returns `{definition, raw, revision}` (revision = content hash), write with matching revision succeeds, mismatched revision fails `workflow_file_conflict`, delete, personal location `~/.orca/workflows/`
- [ ] T038 Create `src/main/runtime/workflows/workflow-file-store.ts` using the same filesystem provider path as `runtime-repository-hooks-commands.ts` (local `node:fs`, SSH via `getSshFilesystemProvider(repo.connectionId)`), exporting `listWorkflows`, `readWorkflow`, `writeWorkflow`, `deleteWorkflow`; YAML via the `yaml` package
- [ ] T039 [P] Create `src/main/runtime/workflows/workflow-source-allowlist.ts` reading `workflows.allowedSources` from the repo's `orca.yaml` on the execution host and exporting `assertSourceAllowed(source, allowlist)` throwing `workflow_source_not_allowed`; test `workflow-source-allowlist.test.ts` including empty/missing allowlist permitting nothing

### RPC family skeleton, events, view registration

- [ ] T040 [P] Create `src/shared/rpc-contract/workflow-params.ts` with strict zod schemas `WorkflowList`, `WorkflowRead`, `WorkflowWrite`, `WorkflowValidate`, `WorkflowDelete`, `WorkflowDuplicate`, `WorkflowImportRole`, `WorkflowDraft` per contracts/rpc-methods.md (all non-identifier fields optional)
- [ ] T041 [P] Create `src/shared/rpc-contract/workflow-run-params.ts` with `WorkflowRunStart`, `WorkflowRunList`, `WorkflowRunShow`, `WorkflowRunControl` (pause/resume/cancel), `WorkflowRunRerun`, `WorkflowRunAnswer`, `WorkflowRunSendMessage` (`mode: z.enum(['queued','interrupt'])`), `WorkflowRunReadNodeOutput`, `WorkflowRunEvents`, `WorkflowTrustDecide`, `WorkflowProposalAction`
- [ ] T042 Create `src/main/runtime/rpc/methods/workflows/definitions.ts`, `runs.ts`, `interaction.ts`, `trust.ts` exporting handlers bound to the shared schemas, and `src/main/runtime/rpc/methods/workflows/index.ts` exporting `WORKFLOW_METHODS`; register in `src/main/runtime/rpc/methods/index.ts`; run `pnpm run generate:rpc-params-catalog` and commit the generated catalog
- [ ] T043 [P] Write `src/main/runtime/rpc/methods/workflows/workflow-methods.test.ts` using the `eraseRpcMethods(...).find` pattern: every method in contracts/rpc-methods.md is registered, non-streaming, and its params schema is the exported shared object
- [ ] T044 [P] Add `{ type: 'workflowRunChanged'; runId: string; reason: 'state'|'attempt'|'question'|'message' }` to `src/shared/runtime-client-events.ts`, the renderer allowlist in `src/renderer/src/runtime/runtime-client-events.ts`, and `runtime.notifyWorkflowRunChanged(payload)` in `src/main/runtime/orca-runtime-get-status.ts` next to `notifyAutomationsChanged`; add local IPC `workflows:changed` in `src/main/window/runtime-window-lifecycle.ts`, preload `src/preload/api/workflows-bridge.ts`, and `src/renderer/src/lib/workflows-changed-window-event.ts`
- [ ] T045 Register the `workflows` top-level view: `TopLevelView` in `src/shared/ui-chrome-types.ts`, `TOP_LEVEL_VIEW_LOOKUP` in `src/shared/top-level-view.ts`, `TopLevelViewSchema` in `src/shared/rpc-contract/client-ui-params.ts` via `openEnum` fallback, `UiViewHistory`/`previousViewBeforeWorkflows`/`openWorkflowsPage`/`closeWorkflowsPage` in `store/slices/ui/ui-slice-contract-core.ts`, `ui-slice-task-actions.ts`, `ui-slice-view-actions.ts`, `RIGHT_SIDEBAR_SUPPRESSED_VIEWS`, `SIMPLE_VIEW_ENTRIES`, `worktree-nav-view-history-replay.ts`, `titlebar-worktree-history-controls.ts`, `feature-interaction-catalog.ts` (`{ id: 'workflows', interaction: 'Workflows page opened' }`), `main-window-service-readiness.ts`
- [ ] T046 Update every test that enumerates view ids (`store/slices/ui-page-navigation.test.ts`, `worktree-nav-history-view-entries.test.ts`, `ui-contextual-tours.test.ts`, `lib/right-sidebar-visibility.test.ts`, `lib/titlebar-worktree-history-controls.test.ts`, `src/main/active-view-preference.test.ts`, `components/sidebar/SidebarNav.test.tsx`, `hooks/useSettingsNavigationMetadata.test.ts`, `shared/contextual-tours.test.ts`, `shared/feature-interactions.test.ts`, `components/settings/AppearancePane.test.tsx`) to include `workflows`
- [ ] T047 Add the Workflows sidebar button to `src/renderer/src/components/sidebar/SidebarNav.tsx` (lucide `Workflow` icon, `shouldShowWorkflowsButton(settings)` = `experimentalWorkflows && showWorkflowsButton !== false`, `HideSidebarMenu`), the View-menu checkbox in `src/main/menu/register-app-menu.ts`, and the Appearance toggle in `components/settings/AppearanceWindowSidebarSection.tsx` and `appearance-sidebar-search.ts`
- [ ] T048 Create `src/renderer/src/components/workflows/WorkflowsPage.tsx` (lazy-mounted in `src/renderer/src/app-shell/AppWorkspaceShell.tsx`, added to the "owns its page header" list) rendering a placeholder header, and `src/renderer/src/runtime/runtime-workflow-client.ts` wrapping every `workflow.*` method over `callRuntimeRpc` with the active target; test `runtime-workflow-client.test.ts`
- [ ] T049 [P] Create the CLI group skeleton: `src/cli/specs/workflows.ts` with every command in contracts/cli.md, `src/cli/handlers/workflows.ts` with `WORKFLOW_HANDLERS`, registration in `src/cli/specs/index.ts`, `src/cli/handler-group-manifest.ts`, `src/cli/root-help-text-primary.ts`, `src/cli/vocabulary-policy.ts`; test `src/cli/handlers/workflows.test.ts` asserting each handler calls the mapped RPC method

**Checkpoint**: Foundation ready. Definitions parse and validate, the DB holds runs, the engine can act on a Run with its own identity, files round-trip on local and SSH, RPC methods are registered and typed, the view exists.

---

## Phase 3: User Story 1 - Draw and run a developer-to-QA workflow (Priority: P1) 🎯 MVP

**Goal**: Draw two Agent nodes with agent, model and effort, save to the project, run with an objective in a fresh workspace, watch live status, open transcript and diff.

**Independent Test**: Quickstart Scenario 1 and Scenario 4 with `two-node.workflow.yaml`: both agents run in order in a new workspace with the chosen settings; the run view shows each node's transitions.

### Tests for User Story 1

- [ ] T050 [P] [US1] Write `src/main/runtime/workflows/workflow-frontier.test.ts`: start node eligible immediately, a node becomes eligible only when every incoming edge's source completed and its condition passes, unconditioned edges fire, a node whose upstream failed is skipped
- [ ] T051 [P] [US1] Write `src/main/runtime/workflows/workflow-brief-builder.test.ts`: brief.md contains the seven sections from contracts/agent-brief.md in order, references resolved, inputs.json written, taskSpec is the three-line pointer and passes `assertWorkerStartTaskSpecWithinPromptBudget`
- [ ] T052 [P] [US1] Write `src/main/runtime/workflows/workflow-result-capture.test.ts`: missing `reportPath` → `result_missing`; invalid JSON → `result_invalid` with raw body kept; schema violation → `result_invalid`; missing required artifact → `artifact_missing`; `outcome: failed` fails even with a valid result; valid result stored with artifacts list
- [ ] T053 [P] [US1] Write `src/main/runtime/workflows/workflow-run-controller.test.ts` with an in-memory `OrchestrationDb` and a fake runtime implementing worker-start, `waitForMessage`, `notifyMessageArrived`, `worktree.create`: two-node run creates an engine-owned Run, one Task per node just in time, dispatches `implement`, and on a synthetic `worker_done` with a valid result creates and dispatches `review`, then completes the run; successor start measured under 5 s on the fake clock
- [ ] T054 [P] [US1] Write `src/renderer/src/components/workflows/editor/workflow-editor-state.test.ts` (happy-dom): add node, connect nodes, edit agent/model/effort, model controls disabled for an agent without a catalog, save produces a definition that passes `validateWorkflowGraph`, manual node positions survive a run-snapshot refresh while untouched nodes follow "Re-layout", and an edge condition edited through the condition builder round-trips into the definition
- [ ] T055 [P] [US1] Write `tests/e2e/workflows/two-node-run.e2e.test.ts` (Vitest, background launch, stub agent): runs `two-node.workflow.yaml` end to end through `orca workflows run` and asserts attempts, effective launch, transcript reference, and that `orca worktree ps` lists the workers

### Implementation for User Story 1

- [ ] T056 [US1] Create `src/main/runtime/workflows/workflow-run-workspace.ts`: `createRunWorkspace(run)` via the existing `worktree.create` path (name `<workflow>-<runId>`, base = project default branch, `runHooks` inherited), and `resolveInPlaceWorkspace` for folder workspaces; test `workflow-run-workspace.test.ts`
- [ ] T057 [US1] Create `src/main/runtime/workflows/workflow-frontier.ts` implementing eligibility, skip propagation, and just-in-time Task creation (`deps` = upstream task ids; set `tasks.workflow_run_id/workflow_node_id/workflow_iteration`)
- [ ] T058 [US1] Create `src/main/runtime/workflows/workflow-brief-builder.ts` writing `brief.md` and `inputs.json` under `.orca/workflow-runs/<runId>/<attemptId>/` through the run workspace filesystem provider, and `buildTaskSpec()`; ensure `.orca` is git-ignored by reusing `ensureOrcaDirIgnored` / `ensureRemoteOrcaDirIgnored`
- [ ] T059 [US1] Create `src/main/runtime/workflows/workflow-node-dispatch.ts`: resolve role/overrides to `{agent, model, effort}`, call `workflow-orchestration-client` `workerStart` with placement, record `requested_launch`/`effective_launch` from the receipt, transition attempt `provisioning → running`
- [ ] T060 [US1] Create `src/main/runtime/workflows/workflow-result-capture.ts`: on `worker_done` read `reportPath`, validate with `z.fromJSONSchema` wrapped in `src/main/runtime/workflows/workflow-result-schema.ts`, check artifacts via the filesystem provider, store result/artifacts/failure reason
- [ ] T061 [US1] Create `src/main/runtime/workflows/workflow-run-controller.ts`: per-run loop that rehydrates from DB, reads the mailbox backlog via `getOrCreateRunDelivery`, awaits `runtime.waitForMessage('run:<id>', { exclusive: true })`, routes `worker_done` to result capture and the frontier, appends `workflow_run_events`, emits `notifyWorkflowRunChanged`, and completes/fails the run
- [ ] T062 [US1] Create `src/main/runtime/workflows/workflow-engine.ts`: registry of active controllers, `startRun`, `getSnapshot`, `rehydrateActiveRuns()` called from runtime startup (`src/main/runtime/orca-runtime.ts` wiring), stop on shutdown; test `workflow-engine.test.ts` for rehydration after a simulated restart
- [ ] T063 [US1] Implement `workflow.list/read/write/validate/delete/duplicate` handlers (`duplicate` reads and writes under `newName`, refusing `workflow_name_taken`) in `src/main/runtime/rpc/methods/workflows/definitions.ts` over the file store, graph validation (with agent catalog support lookup and allowlist), and `workflow.run.start/list/show/readNodeOutput/events` in `runs.ts` (readNodeOutput delegates to `orchestration.workerRead` by dispatch id)
- [ ] T064 [US1] Implement CLI handlers `workflows list|show|validate|run|runs|status` in `src/cli/handlers/workflows.ts` with formatters in `src/cli/handlers/workflows-format.ts` (`--wait` follows `workflow.run.events` until a terminal state)
- [ ] T065 [P] [US1] Create the canvas `src/renderer/src/components/workflows/editor/WorkflowCanvas.tsx` with `@xyflow/react` (import its stylesheet here), dagre auto-layout in `editor/workflow-auto-layout.ts`, and custom node components `editor/nodes/AgentNode.tsx`, `StartNode.tsx`, `EndNode.tsx` using `main.css` tokens only (status colours from `--workspace-status-*` and `--status-success*`)
- [ ] T066 [P] [US1] Create `src/renderer/src/components/workflows/editor/use-workflow-editor-state.ts` (reducer over definition + layout, undo stack, dirty flag, revision) and `editor/workflow-editor-commands.ts` (add node, connect with cycle refusal via `workflow-graph-cycles`, delete, update node)
- [ ] T067 [US1] Create `src/renderer/src/components/workflows/editor/NodeInspector.tsx` and `editor/AgentNodeFields.tsx`: agent picker (reuse `components/agent/AgentCombobox.tsx`), model and effort from `agent-session-option-catalog` with disabled state and reason for agents without a catalog, prompt, workspace policy, result contract JSON editor, artifacts list; create `editor/ConditionBuilder.tsx` here and attach it to edge selection in `NodeInspector.tsx` so FR-008 edge conditions are editable
- [ ] T068 [US1] Create `src/renderer/src/components/workflows/WorkflowListPane.tsx` and `use-workflows-page-controller.ts` (list, open, create, duplicate via `workflow.duplicate`, delete, save with revision conflict dialog `editor/FileConflictDialog.tsx`, external change reload via `subscribeRuntimeFileChanges`), wire into `WorkflowsPage.tsx`
- [ ] T069 [US1] Create `src/renderer/src/components/workflows/editor/ValidationProblemsPanel.tsx` listing every Problem from `validateWorkflowGraph` and from the host `workflow.validate` result, with click-to-focus on the offending node, edge or role, blocking Run while any error remains; wire it into `use-workflows-page-controller.ts` and test it in `editor/validation-problems-panel.test.tsx`
- [ ] T070 [US1] Create `src/renderer/src/components/workflows/run-view/RunToolbar.tsx` (objective input, Run, Stop, and a "Re-layout" action that reruns `workflow-auto-layout.ts` only for nodes the user has not dragged) and `run-view/RunCanvasOverlay.tsx` painting attempt states onto nodes, refreshing on `workflows:changed`/`workflowRunChanged` through `run-view/use-workflow-run-snapshot.ts`
- [ ] T071 [US1] Create `src/renderer/src/components/workflows/run-view/AttemptPanel.tsx` showing requested vs effective launch, result, artifacts, and buttons that open the transcript (reuse the terminal/agent-session focus path from `terminal-orchestration-task-links.ts`) and the workspace diff tab
- [ ] T072 [US1] Add `translate()` strings for all new UI in `src/renderer/src/components/workflows/**` under keys `auto.components.workflows.*`, run `pnpm run sync:localization-catalog` to update `src/renderer/src/i18n/locales/en.json`, then run `pnpm run check:code-quality:changed` and fix design-system findings

**Checkpoint**: A two-node workflow can be drawn, saved, run, and observed. Existing readers list its workers unchanged (SC-007).

---

## Phase 4: User Story 2 - Bounded review loop (Priority: P1)

**Goal**: Loop container with cap and exit condition; previous iteration results flow into the next; cap reached fails the run.

**Independent Test**: Quickstart Scenario 2 with `feature-with-qa.workflow.yaml` and the stub reviewer scripted reject, reject, approve, then always reject.

### Tests for User Story 2

- [ ] T073 [P] [US2] Write `src/main/runtime/workflows/workflow-loop-unrolling.test.ts`: iteration bookkeeping, exit condition true exits, false with room iterates with `loop.previous.*` inputs populated, cap reached fails the loop and run, Tasks per iteration carry `workflow_iteration`
- [ ] T074 [P] [US2] Extend `src/renderer/src/components/workflows/editor/workflow-editor-state.test.ts`: saving a Loop without `maxIterations` is blocked with a message; drawing a back-edge outside a Loop is refused and the "wrap in Loop" action wraps the selected nodes
- [ ] T075 [P] [US2] Extend `tests/e2e/workflows/two-node-run.e2e.test.ts` with a `feature-with-qa` loop run (approval auto-answered by the test via `workflow.run.answer`) asserting three iterations, per-iteration results in `workflow.run.show`, and that the run resumes within 5 s of the answer (SC-006)

### Implementation for User Story 2

- [ ] T076 [US2] Create `src/main/runtime/workflows/workflow-loop-unrolling.ts` (iteration state per Loop node, entry/exit ports, `exitCondition` evaluation with `evaluateCondition`, `onCapReached: 'fail'`) and integrate with `workflow-frontier.ts` so body nodes are created per iteration
- [ ] T077 [US2] Expose `loop.previous.<nodeId>` and iteration number in `workflow-brief-builder.ts` inputs and mark loop failure reason `loop_cap_reached` in `workflow-result-capture.ts`
- [ ] T078 [P] [US2] Create `src/renderer/src/components/workflows/editor/nodes/LoopNode.tsx` (container rendering with React Flow parent/child nodes, iteration badge in run view) and `editor/LoopNodeFields.tsx` (maxIterations required, exit condition via the existing `editor/ConditionBuilder.tsx`)
- [ ] T079 [US2] Add the "wrap selection in Loop" command and back-edge refusal message to `editor/workflow-editor-commands.ts`; show the active iteration and per-iteration results in `run-view/AttemptPanel.tsx`

**Checkpoint**: The developer-to-QA loop terminates by approval or by cap in every test (SC-003).

---

## Phase 5: User Story 3 - Parallel branches with a join (Priority: P2)

**Goal**: Fan-out runs concurrently within a per-run limit, optionally in child workspaces; Join policies all/any/quorum with failure policies.

**Independent Test**: Quickstart Scenario 3 plus an e2e fan-out of three stub nodes into a Join.

### Tests for User Story 3

- [ ] T080 [P] [US3] Write `src/main/runtime/workflows/workflow-join-policy.test.ts`: `all` waits for last, skipped counts as satisfied, `any` proceeds on first, `quorum(n)`, `onFailure: fail` fails join and requests stop of siblings, `skip` treats failures as skipped, `partial` exposes `join.branches`
- [ ] T081 [P] [US3] Write `src/main/runtime/workflows/workflow-concurrency.test.ts`: at most `concurrencyLimit` attempts in `running`, queued attempts start as slots free
- [ ] T082 [P] [US3] Extend `workflow-run-workspace.test.ts`: child workspace created via `worker-start --worktree new-child` placement, disabled under `in-place` with a Problem
- [ ] T083 [P] [US3] Write `src/main/runtime/workflows/workflow-router.test.ts`: a Router attempt whose `result.choice` is not one of `choices` fails with `result_invalid` and fires no edge; a valid choice fires only the matching option-port edge and marks the other branches Skipped; `reason` is stored on the attempt and appended to `workflow_run_events`

### Implementation for User Story 3

- [ ] T084 [US3] Create `src/main/runtime/workflows/workflow-join-policy.ts` and integrate into `workflow-frontier.ts`; on `fail` call `orchestration.workerStop` for running sibling attempts through `workflow-orchestration-client.ts`
- [ ] T085 [US3] Create `src/main/runtime/workflows/workflow-concurrency.ts` (per-run semaphore, default 4, `overrides.concurrencyLimit` from `workflow.run.start`) and use it in `workflow-node-dispatch.ts`
- [ ] T086 [US3] Add child workspace placement (`workspace: 'child'` → `worktree: 'new-child'` with the run workspace as parent) to `workflow-node-dispatch.ts` and record `workspace_worktree_id` on the attempt
- [ ] T087 [P] [US3] Create `src/renderer/src/components/workflows/editor/nodes/JoinNode.tsx` and `editor/JoinNodeFields.tsx` (policy and failure policy selects), show per-branch outcome in `run-view/AttemptPanel.tsx`, and show the workspace used per node in `run-view/RunCanvasOverlay.tsx`
- [ ] T088 [US3] Create `src/main/runtime/workflows/workflow-router.ts` (fixed result contract `{ choice: string; reason: string }`, choice-port routing, mismatch failure) and integrate it with `workflow-frontier.ts` and `workflow-node-dispatch.ts` so Router briefs list the allowed choices verbatim
- [ ] T089 [P] [US3] Create `src/renderer/src/components/workflows/editor/nodes/RouterNode.tsx` and `editor/RouterNodeFields.tsx` (role, overrides, prompt, choices list with exactly one outgoing port per choice) and show the recorded choice and reason in `run-view/AttemptPanel.tsx`

**Checkpoint**: Three parallel nodes run in separate child workspaces and join under each policy.

---

## Phase 6: User Story 4 - Roles with skills, imported and auto-provisioned (Priority: P2)

**Goal**: Roles in the workflow file, import from an allowlisted repository, per-node overrides, skill provisioning at workspace scope (repository) and host scope (plugin, after trust), prompt fallback for agents without skill paths, nothing untracked in git.

**Independent Test**: Quickstart Scenario 5.

### Tests for User Story 4

- [ ] T090 [P] [US4] Write `src/main/runtime/workflows/workflow-role-import.test.ts`: import copies the role into the definition with `origin {source, version, importedAt, localModified:false}`, re-import updates and flags `localModified` when the local copy differs, non-allowlisted source refused
- [ ] T091 [P] [US4] Write `src/main/runtime/workflows/workflow-skill-provisioning.test.ts` with a fake `runProcess`: repository skill installs with `skills add <location> --skill <name> --agent <provider> -y` in the run workspace cwd, installed path appended to `.git/info/exclude` and removed on cleanup, plugin skill without trust yields a `trust` question, refused trust fails the node, trusted source installs via the provider plugin command, agent without a workspace skill path triggers prompt fallback
- [ ] T092 [P] [US4] Write `src/renderer/src/components/workflows/roles/role-override-state.test.ts`: override shown distinctly, revert restores role default, editor warning for agents without skill support

### Implementation for User Story 4

- [ ] T093 [US4] Create `src/main/runtime/workflows/workflow-role-import.ts` (fetch role file from a repository location on the execution host with `runProcess` git clone to a temp dir, allowlist check, copy into definition, revision bump) and implement `workflow.importRole` in `methods/workflows/definitions.ts`
- [ ] T094 [US4] Create `src/main/runtime/workflows/workflow-skill-provisioning.ts` for LOCAL workspaces (repository installs via the skills CLI through `runProcess` with the run workspace as cwd, provider workspace paths from `src/shared/skill-install-providers.ts`, per-path `.git/info/exclude` entries via `src/main/runtime/workflows/workflow-git-exclude.ts`) and call it from `workflow-node-dispatch.ts` before `workerStart` while the attempt is `provisioning`
- [ ] T095 [US4] Create `src/main/runtime/workflows/workflow-skill-provisioning-remote.ts`: run the same skills CLI install on SSH-backed workspaces through the relay exec path that `installSkillOnSshHost` in `src/main/skills/` already uses, and on WSL workspaces through `buildWslExecArgs` per `docs/reference/wsl-command-execution.md`; never fall back to a local install; extend `workflow-skill-provisioning.test.ts` with SSH, WSL, and unreachable-host refusal cases
- [ ] T096 [US4] Verify on a real host that the Claude Code CLI exposes a non-interactive plugin install subcommand (capture `claude plugin --help` output and the exact invocation into `docs/reference/visual-dag-workflows.md` under "Plugin provisioning evidence"); then create `src/main/runtime/workflows/workflow-plugin-install.ts` with a per-provider table built only from verified commands (providers without one are verify-only: the node fails with install instructions), presence check reusing `src/main/skills/claude-plugin-skill-sources.ts`, and `workflow-source-trust.ts` that raises a `trust` question through the question store and reads `workflow_source_trust`; implement `workflow.trust.list/decide` in `methods/workflows/trust.ts`
- [ ] T097 [US4] Add the skills section and prompt fallback (inline skill text for providers without a workspace skill path) to `workflow-brief-builder.ts`
- [ ] T098 [P] [US4] Create `src/renderer/src/components/workflows/roles/RoleEditor.tsx`, `roles/SkillReferenceList.tsx`, `roles/SkillSourceBadge.tsx`, `roles/ImportRoleDialog.tsx` (source must be allowlisted; shows the allowlist location on refusal), and `roles/TrustSourceDialog.tsx`
- [ ] T099 [US4] Add role assignment and override display (distinct styling, revert action) to `editor/AgentNodeFields.tsx`, and a warning banner for agents without workspace skill support
- [ ] T100 [US4] Show the `provisioning` state and provisioning steps/results on `run-view/AttemptPanel.tsx`; surface trust questions in the run view via `run-view/QuestionCard.tsx` (created here, reused by US5)
- [ ] T101 [US4] Add `workflows trust` to `src/cli/handlers/workflows.ts`

**Checkpoint**: A role imported from a test repository provisions both skill kinds before launch, with nothing untracked in git.

---

## Phase 7: User Story 5 - Human approval and agent questions inside a run (Priority: P2)

**Goal**: Approval node backed by decision gates; agent questions surfaced to every paired client; timeouts with escalation; queued and interrupt follow-ups; notifications; mobile answering.

**Independent Test**: Quickstart Scenario 6 plus answering an approval from the mobile companion.

### Tests for User Story 5

- [ ] T102 [P] [US5] Write `src/main/runtime/workflows/workflow-approval-gates.test.ts`: approval creates a placeholder Task and gate, run enters `waiting`, resolution routes on the matching option edge, reject with no edge ends the run, timeout escalates then applies `defaultOption` or fails, works inside a Loop each iteration
- [ ] T103 [P] [US5] Write `src/main/runtime/workflows/workflow-agent-questions.test.ts`: a `question` message moves the attempt to `waiting`, emits `workflowRunChanged` and a `workflow-attention` notification, `answer` calls `db.answerQuestion` with the engine consumer generation and notifies `dispatch:<id>`, expiry escalates then stops the worker and fails the node, other attempts continue
- [ ] T104 [P] [US5] Write `src/main/runtime/workflows/workflow-follow-up-delivery.test.ts`: queued message recorded `queued` then `delivered` after `orchestration.send`, interrupt uses `terminal.send` for terminal workers and `agentSession.send` for structured workers, both recorded with mode and sender
- [ ] T105 [P] [US5] Write `src/main/runtime/runtime-rpc-mobile-method-allowlist.test.ts` additions asserting `workflow.run.list/show/answer/events` are allowlisted, and `mobile/src/workflows/workflow-prompt-card.test.tsx` rendering an approval and an agent question with answer actions

### Implementation for User Story 5

- [ ] T106 [US5] Create `src/main/runtime/workflows/workflow-approval-gates.ts` (placeholder Task + `gateCreate`, gate resolution → attempt result `{ option }`, option-port routing, timeout/escalation timers, default option) and integrate with `workflow-frontier.ts`
- [ ] T107 [US5] Create `src/main/runtime/workflows/workflow-agent-questions.ts` (mailbox `question` → question store → `waiting`, answer path, expiry → `workerStop` + fail) and hook it into `workflow-run-controller.ts`; ensure node `question.timeoutMs` never exceeds the worker `ask` timeout ceiling from `src/shared/orchestration-ask-timeout.ts`
- [ ] T108 [US5] Create `src/main/runtime/workflows/workflow-follow-up-delivery.ts` and implement `workflow.run.answer` and `workflow.run.sendMessage` in `methods/workflows/interaction.ts`
- [ ] T109 [US5] Create `src/main/runtime/workflows/workflow-notifications.ts`: add source `workflow-attention` to `MobileNotificationDispatchEvent.source`, `MOBILE_PUSH_SOURCES` in `src/shared/mobile-push-contract.ts`, the stream filter in `methods/notification-stream-policy.ts`, and a host-originated dispatch modelled on `RuntimeMobileNotificationController.dispatchPlugin`; test `workflow-notifications.test.ts`
- [ ] T110 [US5] Add `workflow.run.list`, `workflow.run.show`, `workflow.run.answer`, `workflow.run.events` to `MOBILE_RPC_METHOD_ALLOWLIST` in `src/main/runtime/runtime-rpc/runtime-rpc-mobile-method-allowlist.ts`
- [ ] T111 [P] [US5] Create `src/renderer/src/components/workflows/editor/nodes/ApprovalNode.tsx` and `editor/ApprovalNodeFields.tsx` (question, options with one port each, timeout, escalation grace, default option); create `run-view/FollowUpComposer.tsx` (queued by default, explicit "Interrupt now" action, delivery state per message) and extend `run-view/QuestionCard.tsx` for approvals and agent questions with answerer and time
- [ ] T112 [P] [US5] Create `mobile/src/workflows/WorkflowRunList.tsx`, `mobile/src/workflows/WorkflowPromptCard.tsx` (approval and agent question, answer via `workflow.run.answer`), and `mobile/src/workflows/use-workflow-runs.ts` (refetch on `workflowRunChanged` and `workflow-attention` notifications), navigable from the existing mobile session list
- [ ] T113 [US5] Add `workflows answer|send` handlers to `src/cli/handlers/workflows.ts`

**Checkpoint**: Approvals and agent questions pause only their node, appear on desktop, CLI and mobile, and resume within 5 s of an answer (SC-006).

---

## Phase 8: User Story 6 - Describe a workflow and let an agent draft it (Priority: P3)

**Goal**: Draft a valid workflow from an objective using a planning agent.

**Independent Test**: Quickstart-style check: a one-paragraph objective yields a draft that passes `validateWorkflowGraph` and is editable.

### Tests for User Story 6

- [ ] T114 [P] [US6] Write `src/main/runtime/workflows/workflow-draft.test.ts` with the stub agent returning a definition: draft is validated, problems attached, draft flagged and not written to disk until saved

### Implementation for User Story 6

- [ ] T115 [US6] Create `src/main/runtime/workflows/workflow-draft.ts`: run a single one-off Agent node (planner role from settings default) whose result contract is the workflow definition schema, validate, return `{definition, problems}`; implement `workflow.draft` in `methods/workflows/definitions.ts`
- [ ] T116 [P] [US6] Add `src/renderer/src/components/workflows/DraftWorkflowDialog.tsx` and a "Draft from objective" action in `WorkflowListPane.tsx`; drafts open in the editor with a draft badge until first save

**Checkpoint**: A drafted workflow appears on the canvas fully specified and editable.

---

## Phase 9: User Story 7 - Reflection node that proposes role improvements (Priority: P3)

**Goal**: Reflection node produces role proposals with evidence; accept into the file or export toward the origin repository.

**Independent Test**: Run a workflow ending in a Reflection node with the stub agent returning two proposals; accept one, export one.

### Tests for User Story 7

- [ ] T117 [P] [US7] Write `src/main/runtime/workflows/workflow-role-proposals.test.ts`: proposals stored per run with evidence, accept updates the role in the file and records the run, export writes a change bundle for the origin source and marks `exported`

### Implementation for User Story 7

- [ ] T118 [US7] Create `src/main/runtime/workflows/workflow-role-proposals.ts` (store, accept via `workflow-file-store`, export to `.orca/workflow-runs/<runId>/proposals/<roleId>.patch` plus a README describing the origin's contribution flow) and implement `workflow.proposal.accept/export` in `methods/workflows/interaction.ts`; add the `workflow_role_proposals` mixin `db/workflow-runs/workflow-proposal-store.ts`
- [ ] T119 [US7] Give Reflection nodes their fixed result contract in `workflow-node-dispatch.ts` and feed run transcripts/results paths into their brief in `workflow-brief-builder.ts`
- [ ] T120 [P] [US7] Create `src/renderer/src/components/workflows/editor/nodes/ReflectionNode.tsx` and `run-view/RoleProposalPanel.tsx` (diff against the role, Accept, Export)

**Checkpoint**: Proposals show as diffs and can be accepted locally or exported.

---

## Phase 10: User Story 8 - Run history, rerun and portability (Priority: P3)

**Goal**: History per workflow, rerun from a failed node keeping upstream results, pause/resume/cancel, identical behaviour on Remote Orca Server and SSH-backed projects, recovery after restart and disconnect.

**Independent Test**: Quickstart Scenarios 8 and 9 plus a rerun-from-node test.

### Tests for User Story 8

- [ ] T121 [P] [US8] Write `src/main/runtime/workflows/workflow-rerun.test.ts`: rerun from node N creates a new run referencing `rerun_of_run_id`, copies completed upstream attempts' results, executes only N and descendants
- [ ] T122 [P] [US8] Write `src/main/runtime/workflows/workflow-run-control.test.ts`: pause stops new dispatches but running attempts finish, resume continues, cancel asks every live worker to stop and marks `cancelled`
- [ ] T123 [P] [US8] Write `src/main/runtime/workflows/workflow-run-controller.rehydrate.test.ts`: after a simulated runtime restart with a running attempt, the controller resumes waiting without re-dispatching, a lost remote contact marks the attempt `unverifiable`, never `failed`; and `workflow.run.start` against an SSH-backed repository whose host is unreachable refuses with `workflow_host_unreachable` and creates no local workspace (FR-038)
- [ ] T124 [P] [US8] Write `tests/e2e/workflows/remote-run.e2e.test.ts` (paired `orca serve` in the same test host, background launch): run continues while the client is disconnected and the snapshot after reconnect is complete

### Implementation for User Story 8

- [ ] T125 [US8] Create `src/main/runtime/workflows/workflow-rerun.ts` and `workflow-run-control.ts` (pause/resume/cancel) and implement `workflow.run.pause/resume/cancel/rerun` in `methods/workflows/runs.ts`
- [ ] T126 [US8] Map dispatch liveness (`projection.liveness`) into attempt `unverifiable` handling in `workflow-run-controller.ts`, using `worker-list` verdicts and never inferring exit from silence
- [ ] T127 [US8] Gate the Workflows view per paired environment on `WORKFLOW_ENGINE_RUNTIME_CAPABILITY` via `runtimeEnvironmentSupportsCapability` in `use-workflows-page-controller.ts`, and make mobile probes treat `forbidden` and `method_not_found` as absent
- [ ] T128 [P] [US8] Create `src/renderer/src/components/workflows/run-view/RunHistory.tsx` (list of past runs with outcome and duration, open any run, "Rerun from this node" action) and `run-view/RunControls.tsx` (pause/resume/cancel)
- [ ] T129 [US8] Add `workflows pause|resume|cancel|rerun` handlers to `src/cli/handlers/workflows.ts`

**Checkpoint**: Runs survive restarts and disconnects; the same file runs identically on local, SSH and remote hosts (SC-004, SC-008).

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, compliance gates, and the fork's governance obligations.

- [ ] T130 [P] Write `docs/reference/visual-dag-workflows.md` (engine principal, just-in-time Tasks, result contract, skill provisioning, file location, capability, and a glossary line stating that "workspace" in the spec means a git worktree or a folder workspace) linked from `AGENTS.md` under Agent Status/Orchestration
- [ ] T131 [P] Create the fork divergence record `docs/reference/fork-divergences.md` required by the constitution, listing the engine principal change, the `workflows` orca.yaml key, and the new renderer dependencies
- [ ] T132 [P] Write `src/main/runtime/workflows/workflow-engine.no-electron.test.ts` asserting no module under `src/main/runtime/workflows/` imports `electron`, and run `pnpm run check:runtime-electron-ratchet`
- [ ] T133 [P] Add the cross-version check: extend `tests/e2e/cross-version-wire/` with a case that an old client ignores `workflowRunChanged` and that `ui.set` with `activeView: 'workflows'` falls back on an old host
- [ ] T134 [P] Add a `workflows-provisioning` job to the CI workflow under `.github/workflows/` running quickstart Scenario 5 on `macos-latest`, `ubuntu-latest` and `windows-latest` against a stub skill repository fixture in `tests/fixtures/workflows/skill-repo/`, so SC-005 is verified on all three platforms
- [ ] T135 Create `config/scripts/workflow-editor-cdp-check.mjs` (background Electron launch, open Workflows view, load `feature-with-qa`, screenshot light and dark, assert no console errors) and document it in quickstart Scenario 7
- [ ] T136 Run `pnpm run sync:localization-catalog`, `pnpm run verify:localization-coverage`, `pnpm run lint:design-system` and fix every finding in `src/renderer/src/components/workflows/`
- [ ] T137 Run the full gate `pnpm tc && pnpm test && pnpm run check:code-quality:changed && pnpm lint` and every quickstart scenario; record results in `specs/001-visual-dag-workflows/quickstart.md` under a "Last validated" line
- [ ] T138 Fill `.github/pull_request_template.md` for the PR (ELI5, before/after, mechanism, why over alternatives, platforms tested, visual proof from T135)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Phase 1. BLOCKS all user stories. Inside it: T008–T019 (shared model) and T020–T030 (persistence) are independent groups; T031–T035 (principal) depend on T030; T036–T039 (file store) depend on T011; T040–T049 depend on T011 and T017.
- **US1 (Phase 3)**: Depends on Phase 2. First deliverable.
- **US2 (Phase 4)**: Depends on US1 (frontier, brief builder, canvas).
- **US3 (Phase 5)**: Depends on US1; independent of US2.
- **US4 (Phase 6)**: Depends on US1 (dispatch, brief builder); independent of US2/US3.
- **US5 (Phase 7)**: Depends on US1; `QuestionCard.tsx` is created in US4 (T100) and extended here, so run T100 before T111 or create the card in whichever phase runs first.
- **US6 (Phase 8)**: Depends on US1 and US4 (roles).
- **US7 (Phase 9)**: Depends on US4 (roles) and US1.
- **US8 (Phase 10)**: Depends on US1; remote e2e depends on nothing else.
- **Polish (Phase 11)**: Depends on every story you intend to ship.

### Within Each User Story

- Tests first; confirm they fail; then implementation.
- Engine modules before RPC handlers before renderer before CLI/mobile.
- Story complete (checkpoint verified) before the next priority.

### Parallel Opportunities

- Phase 1: T002–T007 in parallel after T001.
- Phase 2: shared-model tests T008/T010/T012/T014/T018 in parallel; stores T023–T029 in parallel; T036, T039, T040, T041, T043, T044, T049 in parallel.
- US1: T050–T055 in parallel; T065/T066 in parallel with T056–T062.
- US3, US4 and US5 can proceed in parallel after US1 by different developers.
- Polish: T130–T134 in parallel.

---

## Parallel Example: User Story 1

```bash
# Tests first, all independent files:
Task: "workflow-frontier.test.ts"          (T050)
Task: "workflow-brief-builder.test.ts"     (T051)
Task: "workflow-result-capture.test.ts"    (T052)
Task: "workflow-run-controller.test.ts"    (T053)
Task: "workflow-editor-state.test.ts"      (T054)

# Then engine and renderer in parallel:
Task: "workflow-run-workspace.ts, workflow-frontier.ts, workflow-brief-builder.ts"  (T056–T058)
Task: "WorkflowCanvas.tsx + use-workflow-editor-state.ts"                           (T065–T066)
```

---

## Implementation Strategy

### MVP First (User Stories 1 and 2)

1. Phase 1 and Phase 2.
2. Phase 3 (US1): draw, save, run, observe a two-node workflow.
3. Phase 4 (US2): the bounded review loop, the motivating example.
4. STOP and validate with quickstart Scenarios 1, 2 and 4. Demo.

### Incremental Delivery

1. US3 parallel branches, then US4 roles and skills (unlocks non-coding playbooks), then US5 approvals and questions (unlocks unattended runs).
2. US8 history and portability before relying on runs for client work.
3. US6 drafting and US7 reflection last.

### Parallel Team Strategy

After Phase 2: developer A takes US1 then US2; developer B takes US4 (engine side can start against the US1 dispatch interface once T059 lands); developer C takes US5 mobile and notification work; UI work on US3/US5 nodes can proceed against the editor state from T066.

---

## Notes

- Every task names its file; split any file approaching the max-lines limit instead of disabling the rule.
- Never `.catch()` an enum on the wire; use `openEnum` (`src/shared/zod-salvage.ts`).
- Any agent-screen rule (readiness, idle) needs a captured transcript per `docs/reference/agent-pty-transcript-capture.md`; none is planned here.
- Commit after each task or logical group with the PR attribution lines from the repository guidance.
