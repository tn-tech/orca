# Implementation Plan: Visual DAG Workflows

**Branch**: `001-visual-dag-workflows` | **Date**: 2026-09-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-visual-dag-workflows/spec.md`

## Summary

Add a Workflows view to Orca where a user draws a graph of agent nodes (agent, model, effort,
role, skills, prompt, result contract), with Loop, Join, Approval, Router and Reflection nodes,
and runs it in its own workspace. A deterministic engine inside the Orca runtime walks the graph
on top of the existing orchestration primitives (Run, Task, Dispatch, supervised workers,
mailboxes, decision gates), creating Tasks just in time so loops unroll into an acyclic Task
graph. Results are JSON files validated against each node's schema; skills are provisioned per
run workspace from an allowlisted source; approvals and agent questions surface on desktop,
mobile and CLI. The workflow file is committed YAML under `orca-workflows/`. Decisions and their
rationale are in [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript ^7.0 on Node 24 (engines), Electron 43.7; React 19.2 renderer;
mobile Expo 55 / React Native 0.83 sharing `src/shared/`.

**Primary Dependencies**: existing: zod ~4.5 (schemas, `z.fromJSONSchema` for result
contracts), `yaml` ^2.8 (workflow file), Zustand 5, Tailwind 4 + shadcn primitives, i18next,
`node:sqlite` via `src/main/sqlite/sync-database.ts`. New: `@xyflow/react` 12.11.6 (MIT) and
`@dagrejs/dagre` 3.1.1 (MIT) in the renderer only (see research R10).

**Storage**: orchestration SQLite (`userData/orchestration.db`, schema 41 → 42: new
`workflow_*` tables plus nullable workflow columns on `tasks` and `runs`); workflow definitions
as tracked YAML files in the project; briefs and results as files under the run workspace's
`.orca/workflow-runs/`; per-host trust decisions in SQLite.

**Testing**: Vitest (node default, happy-dom opt-in), `OrchestrationDb(':memory:')` for engine
tests, testing-library for renderer, stub agent through the launch command override for
end-to-end runs, Playwright CDP against a background Electron window for UI checks, existing
cross-version wire tests.

**Target Platform**: macOS, Linux, Windows desktop; runtime may be local, an SSH-backed
project, or a paired Remote Orca Server; mobile companion for viewing and answering.

**Project Type**: Electron desktop app with shared runtime service, CLI and mobile client
(monorepo, existing layout).

**Performance Goals**: successor node starts within 5 s of predecessor `worker_done`
(SC-002); editor interactive for graphs up to 100 nodes; run view refresh under 1 s after a
change event on local hosts.

**Constraints**: engine modules reachable from `orca-runtime.ts` must not import `electron`
(ratchet); files ≤ 300 lines `.ts` / 400 `.tsx` (max-lines ratchet, no disables); no direct
`child_process` (use `runProcess`); optional RPC fields only, no new stream opcode; any
`src/shared` module mobile imports must be React Native safe; liveness vocabulary
`live / unverifiable / exited`; no local fallback when the owning host is unreachable.

**Scale/Scope**: workflows of 5–50 nodes, runs of up to a few hundred attempts, single-digit
concurrent workers per run (default concurrency 4, configurable), tens of runs of history per
workflow.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Reuse Before Reimplementing | PASS | Engine composes existing Run/Task/Dispatch, `worker-start`, mailbox waiters, decision gates, `ask`/`reply`, `terminal.send`, `worktree.create`, skills CLI path, Automations change-event pattern, Automations page structure (research R1–R9, R11–R12). New code is the graph walker, result capture, file store, view and RPC family. |
| II. Every Host Is a First-Class Host | PASS | Engine runs where the orchestration DB lives; workers placed through existing local, SSH and federation paths; folder workspaces run in place (R12); Windows via `runProcess`; verdict vocabulary preserved (FR-032). |
| III. Evidence Over Assumption | PASS | Every attempt records requested vs effective launch, result validation outcome and transcript reference; stub-agent e2e and unit tests per quickstart; no agent screen parsing introduced. |
| IV. One Owner Per Fact | PASS | Agent status stays in the hook-server store (engine reads `worker_done` and dispatch status, never writes status); `workflow_runs` is the single owner of run state; renderer, mobile and CLI read `workflow.run.show`. |
| V. Compatibility Is a Contract | PASS | One host capability `workflow.engine.v1`; new event type on the existing client-events stream (rule 1); no opcode (rule 2); versioned workflow file; `openEnum` for the view id; mobile probes treat `forbidden` and `method_not_found` alike (R14). |
| VI. Upstream Baseline | PASS with justification | Additive modules, a new view, optional fields and one migration. Two new renderer dependencies (React Flow, dagre) justified in R10; React Flow's internal Zustand 4 is a contained duplication. `resolveOrchestrationCaller` gains a principal kind, a minimal touch to upstream engine code recorded in Complexity Tracking. |
| Testing rules (III) | PASS | New standalone tests per module; existing orchestration tests untouched; regression tests for the principal and migration. |

Post-design re-check (after Phase 1): no new violations. The Complexity Tracking table below
records the two deliberate deviations from the simplest path.

## Project Structure

### Documentation (this feature)

```text
specs/001-visual-dag-workflows/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 decisions R1–R15
├── data-model.md        # Phase 1 entities, tables, state machines
├── quickstart.md        # Phase 1 validation scenarios
├── contracts/
│   ├── workflow-file.md # YAML file contract and example
│   ├── rpc-methods.md   # workflow.* RPC family, events, mobile allowlist
│   ├── cli.md           # orca workflows command group
│   └── agent-brief.md   # brief.md / result.json contract
├── checklists/requirements.md
├── prior-art/           # research reports (external tools, upstream issues, codebase internals)
└── tasks.md             # Phase 2 output (/speckit-tasks - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/shared/workflows/                          # React Native safe, no node:/electron
├── workflow-definition-types.ts               # Workflow, Role, Node, Edge, Condition
├── workflow-definition-schema.ts              # zod schema + version upgrade
├── workflow-graph-validation.ts               # Start/End, cycles outside Loop, Join/Approval rules
├── workflow-condition-evaluation.ts           # Condition over structured results
├── workflow-run-types.ts                      # RunSummary, RunSnapshot, attempt/question/message types
├── workflow-node-states.ts                    # state enums + allowed transitions
└── workflow-brief-references.ts               # ${objective}, ${upstream.*}, ${loop.previous.*} resolution
src/shared/rpc-contract/
├── workflow-params.ts                         # definition methods
└── workflow-run-params.ts                     # run, answer, message, trust methods
src/shared/protocol-version.ts                 # + WORKFLOW_ENGINE_RUNTIME_CAPABILITY
src/shared/runtime-client-events.ts            # + workflowRunChanged
src/shared/orca-yaml.ts, src/main/hooks.ts     # + workflows.directory / allowedSources key

src/main/runtime/workflows/
├── workflow-engine.ts                         # per-runtime registry of active runs, start/stop/rehydrate
├── workflow-run-controller.ts                 # one run: frontier, mailbox wait loop, state transitions
├── workflow-frontier.ts                       # eligibility, just-in-time Task creation, skip propagation
├── workflow-loop-unrolling.ts                 # iteration bookkeeping, exit condition, cap
├── workflow-join-policy.ts                    # all/any/quorum + onFailure
├── workflow-node-dispatch.ts                  # brief file, taskSpec, worker-start via engine principal
├── workflow-brief-builder.ts                  # brief.md / inputs.json
├── workflow-result-capture.ts                 # worker_done → result.json validation, artifacts
├── workflow-approval-gates.ts                 # Approval node ↔ decision gates
├── workflow-agent-questions.ts                # question messages, timeouts, escalation, answers
├── workflow-follow-up-delivery.ts             # queued send vs interrupt
├── workflow-skill-provisioning.ts             # allowlist check, skills CLI install, info/exclude, plugin trust
├── workflow-source-allowlist.ts               # orca.yaml allowlist read on execution host
├── workflow-file-store.ts                     # list/read/write/watch workflow files (local, SSH, remote)
├── workflow-run-workspace.ts                  # worktree.create / in-place, child workspaces
├── workflow-notifications.ts                  # workflow-attention source
└── workflow-engine-principal.ts               # engine principal for resolveOrchestrationCaller
├── workflow-orchestration-client.ts           # in-process dispatcher calls with the engine principal
├── workflow-router.ts                         # Router node: fixed contract, choice-port routing
├── workflow-concurrency.ts                    # per-run semaphore (default 4)
├── workflow-result-schema.ts                  # z.fromJSONSchema wrapper (swappable validator)
├── workflow-git-exclude.ts                    # per-path .git/info/exclude entries
├── workflow-skill-provisioning-remote.ts      # SSH relay exec and WSL variants of provisioning
├── workflow-plugin-install.ts                 # provider plugin commands (verified before use)
├── workflow-source-trust.ts                   # per-host trust questions and decisions
├── workflow-role-import.ts                    # allowlisted role import with origin/version
├── workflow-rerun.ts, workflow-run-control.ts # rerun-from-node, pause/resume/cancel
├── workflow-draft.ts                          # agent-drafted workflow (P3)
├── workflow-role-proposals.ts                 # Reflection proposals accept/export (P3)
src/main/runtime/orchestration/db/schema/migrate-v42.ts
src/main/runtime/orchestration/db/workflow-runs/*.ts      # mixins for workflow_* tables
src/main/runtime/rpc/methods/workflows/
├── definitions.ts, runs.ts, interaction.ts, trust.ts     # WORKFLOW_METHODS
src/main/runtime/runtime-rpc/runtime-rpc-mobile-method-allowlist.ts   # + workflow.run.* reads/answer

src/renderer/src/components/workflows/
├── WorkflowsPage.tsx, use-workflows-page-controller.ts
├── editor/   (WorkflowCanvas.tsx, nodes/*.tsx incl. RouterNode, NodeInspector.tsx, ConditionBuilder.tsx, ValidationProblemsPanel.tsx, use-workflow-editor-state.ts)
├── run-view/ (RunCanvasOverlay.tsx, AttemptPanel.tsx, QuestionCard.tsx, FollowUpComposer.tsx, RunHistory.tsx)
└── roles/    (ImportRoleDialog.tsx, SkillSourceBadge.tsx, TrustSourceDialog.tsx)
src/renderer/src/runtime/runtime-workflow-client.ts
src/renderer/src/store/slices/ui/*                       # + workflows view id, previousViewBeforeWorkflows
src/renderer/src/app-shell/AppWorkspaceShell.tsx, components/sidebar/SidebarNav.tsx
src/renderer/src/i18n/locales/*.json                     # via sync:localization-catalog

src/cli/specs/workflows.ts, src/cli/handlers/workflows.ts, src/cli/handler-group-manifest.ts

mobile/src/workflows/                                    # run list, pending question/approval card

config/scripts/workflow-stub-agent.mjs                   # deterministic stub agent for e2e
tests/fixtures/workflows/                                # sample repo + sample workflow files
```

**Structure Decision**: Follow the existing monorepo layout. Shared types under `src/shared/`
so mobile and CLI reuse them; engine under `src/main/runtime/workflows/` beside orchestration
(never importing `electron`); RPC family under `rpc/methods/workflows/`; renderer feature folder
under `components/workflows/` mirroring Automations; CLI group mirroring `automations`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Touching upstream orchestration caller resolution (`resolveOrchestrationCaller`, `resolveRunScope`, `workers.ts`) to add a `workflow-engine` principal | Every mutation resolves its Run from a live terminal pane; the engine has none | Occupying a hidden terminal (orca-dag's approach) is fragile and visible; direct DB writes skip fencing, federation relay and message notification |
| Two new renderer dependencies (React Flow, dagre) with an internal Zustand 4 copy | No graph or layout capability exists in the codebase; a hand-rolled canvas is months of work | `mermaid` renders static diagrams only; `@dnd-kit` has no edges, ports, viewport or layout |
