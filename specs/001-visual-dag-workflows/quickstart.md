# Quickstart: validating Visual DAG Workflows

Runnable scenarios that prove the feature end to end. Contracts are in `contracts/`, entities
in `data-model.md`. Nothing here contains implementation code.

## Fresh worktree setup (implementation session)

The repo's `.gitignore` excludes `/.claude/skills/` and `/.agents/skills/`, so a new worktree
has `.specify/` (templates, scripts, extensions, the Superpowers handoff) but none of the Spec
Kit or bridge slash commands. Run these once in the new worktree, then start the session with
`/speckit-superpowers-bridge`:

```bash
git fetch origin
git worktree add ../orca-visual-dag-workflows -b 001-visual-dag-workflows origin/main
cd ../orca-visual-dag-workflows
pnpm install
specify integration install claude          # regenerates .claude/skills/speckit-*
specify extension add speckit-superpowers-bridge \
  --from https://github.com/lihan3238/speckit-superpowers-bridge/releases/latest/download/speckit-superpowers-bridge.zip
bash .specify/extensions/speckit-superpowers-bridge/scripts/bash/bridge-status.sh --readiness --actor claude
```

The worktree starts from a freshly fetched `origin/main`, never a local `main`, per the
constitution's worktree workflow. The branch name `001-visual-dag-workflows` is what lets Spec
Kit resolve this feature folder without a per-checkout `.specify/feature.json`.

## Before every pull request (constitution: worktree workflow)

Other agents may have pushed to `main` while this worktree was active. Rebase, then verify on
the rebased tree; a verification that predates the last rebase does not count.

```bash
git fetch origin
git rebase origin/main                      # resolve conflicts, then continue
pnpm tc && pnpm test && pnpm run check:code-quality:changed && pnpm lint
# re-run the quickstart scenarios that cover the changed stories
git push --force-with-lease
```

Repeat the block if `main` moves again while the pull request is open. After merge, remove the
worktree and delete the branch locally and on `origin`.

## Prerequisites
- `pnpm install` on the host OS (add `pnpm install:release` only for cross-arch packaging).
- Orca built once with `pnpm run build:cli` so `orca` resolves.
- All app launches use `ORCA_BACKGROUND_LAUNCH=1`; UI checks use CDP screenshots, never a
  visible window.
- A scratch git repository for runs, for example `tests/fixtures/workflows/sample-repo` cloned to a
  temp directory, with `orca repo add <path>`.
- The stub agent: the launch command override for `claude` and `codex` pointed at
  `config/scripts/workflow-stub-agent.mjs`, which reads the brief, writes `result.json` from a
  scripted table, and sends `worker_done`. This is how loops, joins and gates are exercised
  deterministically without a model.

## Scenario 1 – unit: engine walks a two-node graph
```
pnpm test src/main/runtime/workflows/workflow-engine.test.ts
```
Expected: with an in-memory orchestration DB and a fake runtime, starting the sample
`feature-with-qa` workflow creates one engine-owned Run, one Task for `plan`, dispatches it,
and on a synthetic `worker_done` with a valid `result.json` creates the `approve-plan` gate.
Successor start latency in the test clock is under 5 seconds (SC-002).

## Scenario 2 – loop terminates by exit condition and by cap
```
pnpm test src/main/runtime/workflows/workflow-loop-unrolling.test.ts
```
Expected: reviewer scripted to reject twice then approve → three iterations, `implement`
receives `loop.previous.review.result.findings`, loop exits on approval. Reviewer scripted to
always reject → loop fails after `maxIterations`, run state `failed`, last findings retained
(SC-003).

## Scenario 3 – join policies
```
pnpm test src/main/runtime/workflows/workflow-join-policy.test.ts
```
Expected: `all` waits for the last branch; `any` proceeds on the first; `onFailure: fail` stops
siblings; `partial` exposes per-branch outcomes; a skipped branch satisfies `all`.

## Scenario 4 – end-to-end with the stub agent (local host)
```
ORCA_BACKGROUND_LAUNCH=1 pnpm run test:workflows:e2e -- --workflow feature-with-qa
```
Expected: a new worktree named after the run is created, nodes run in order, the approval is
answered by the test through `orca workflows answer`, the run completes, and
`orca workflows status <run-id> --json` shows every attempt with requested and effective
launch settings and transcript references. The sidebar agent rows and `orca worktree ps` list
the workflow workers with no reader change (SC-007).

## Scenario 5 – skills provisioning
```
pnpm test src/main/runtime/workflows/workflow-skill-provisioning.test.ts
```
Expected: a role naming one repository skill (allowlisted) and one plugin skill: the repository
skill is installed into the run workspace before launch, its path is added to
`.git/info/exclude`, and `git status` shows nothing untracked; the plugin skill triggers a trust
question the first time on the host and is remembered afterwards; a non-allowlisted source
refuses the run with `workflow_source_not_allowed` (FR-015a, FR-018a, FR-021).

## Scenario 6 – agent question and follow-ups
```
pnpm test src/main/runtime/workflows/workflow-agent-questions.test.ts
```
Expected: a worker `ask` moves the attempt to `waiting`, a `workflowRunChanged` event and a
`workflow-attention` notification are emitted, `workflow.run.answer` delivers the reply and the
attempt returns to `running`; an unanswered question escalates then fails the node after the
grace; a queued follow-up is recorded `queued` then `delivered`, and an interrupt is delivered
through `terminal.send` immediately.

## Scenario 7 – renderer: editor and run view
```
pnpm test src/renderer/src/components/workflows
ORCA_BACKGROUND_LAUNCH=1 node config/scripts/workflow-editor-cdp-check.mjs
```
Expected: happy-dom tests cover node creation, edge cycle refusal outside a Loop, save with
revision conflict, and run view state rendering. The CDP script opens the Workflows view in a
hidden window, loads the sample workflow, captures a screenshot in light and dark themes, and
asserts no design-system lint violations on changed lines
(`pnpm run check:code-quality:changed`).

## Scenario 8 – remote and portability
Run Scenario 4 against a paired Remote Orca Server (or `orca serve` on a second machine).
Expected: every node executes on the server, disconnecting the client mid-run does not stop the
run, and reconnecting shows the completed run (FR-039, SC-008). Repeat with an SSH-backed
repository: the run refuses to fall back to local execution when the host is unreachable.

## Scenario 9 – compatibility gates
```
pnpm test tests/e2e/cross-version-wire
pnpm run verify:rpc-params-catalog && pnpm run check:runtime-electron-ratchet && pnpm run check:max-lines-ratchet
```
Expected: all pass; a client paired to a host without `workflow.engine.v1` hides the Workflows
view for that environment.

## Full gate before a PR
```
pnpm tc && pnpm test && pnpm run check:code-quality:changed && pnpm run sync:localization-catalog && pnpm lint
```
