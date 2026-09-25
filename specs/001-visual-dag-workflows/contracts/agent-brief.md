# Contract: Agent brief and result file

What an Agent, Router or Reflection node's worker receives and what it must produce. The engine
writes these files in the run workspace before `worker-start`; paths are workspace-relative and
live under the per-user, git-ignored `.orca/` directory.

## Files written by the engine
```
.orca/workflow-runs/<runId>/<attemptId>/brief.md
.orca/workflow-runs/<runId>/<attemptId>/inputs.json      # upstream results and artifacts, loop.previous, join.branches
```

## `brief.md` sections (in order)
1. **Role** – the role's system prompt (after overrides).
2. **Task** – the node prompt with `${...}` references resolved.
3. **Inputs** – table of upstream node results and artifact paths, plus `inputs.json` path.
4. **Skills** – the skills to use, with the provider-specific invocation (for example
   `/speckit-plan`); for agents without workspace skill support, the skill text is inlined here.
5. **Result** – the JSON Schema the result must satisfy and the exact path to write:
   `.orca/workflow-runs/<runId>/<attemptId>/result.json`.
6. **Artifacts** – required artifact globs the node must produce.
7. **Completion** – restatement of the worker contract: write `result.json`, then send
   `worker_done` once with `--report-path <result.json>` and `--outcome succeeded|failed`.
   Questions go through the coordinator `ask` command shown in the preamble; never open a local
   prompt.

## `taskSpec` passed to `worker-start`
A short pointer, kept inside the prompt budget:
```
Workflow "<workflow>" run <runId>, node "<title>" (attempt <attemptId>).
Read and follow .orca/workflow-runs/<runId>/<attemptId>/brief.md before doing anything else.
Write your result to .orca/workflow-runs/<runId>/<attemptId>/result.json and pass it as --report-path on worker_done.
```

## `result.json`
- Must parse as JSON and validate against the node's `resultContract`.
- Router nodes: `{ "choice": "<one of choices>", "reason": "..." }`.
- Reflection nodes: `{ "proposals": [{ "roleId", "change": { "systemPrompt"?: string, "skills"?: SkillReference[] }, "evidence": string }] }`.
- Optional top-level `artifacts: string[]` adds declared artifact paths beyond the node's list.

## Engine validation on `worker_done`
1. `reportPath` present and inside the attempt directory; otherwise node fails
   (`result_missing`).
2. JSON parses and validates against the contract; otherwise `result_invalid` with the raw body.
3. Every required artifact glob matches at least one existing path; otherwise `artifact_missing`.
4. `outcome: failed` from the worker fails the node even when the result validates.
