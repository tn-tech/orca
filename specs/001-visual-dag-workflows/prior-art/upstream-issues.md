# Upstream stablyai/orca issues that describe this feature (all OPEN, read 2026-09-23)

## #11229 Declarative Workflow Builder for Deterministic Multi-Agent Pipelines (2026-07-28, 4 comments)
- Problem: today either bash scripts around `orca orchestration` or LLM-routed English in a coordinator prompt; both brittle.
- Proposes `orca.workflow.yaml` (or inline in an Automation): `trigger` (schedule/cron, events), `steps` with `type: worker|tool|branch|gate`, `foreach` fan-out, `condition` on structured worker output (`${review_result.findings.length} > 0`), `on_complete` tool calls (linear.comment, linear.status.set), non-LLM dispatcher, visual node editor in the Automations UI, event triggers (on_pr_opened, on_worker_done, on_gate_resolved).
- Motivating case: daily PR review -> if findings -> fixer -> Linear comment.

## #11378 Visual workflow orchestration with agentic loop support (2026-07-29, 1 comment)
- Fixed SDLC stage pipeline in `orca.yaml` (`workflow.stages[]`: research, plan, implement, review), each with `prompt`, `loop: {maxIterations, exitCondition (natural language)}`, `requiresApproval`.
- Approvals surface as Kanban cards; optional drag-and-drop canvas; builds on issueCommand (#9066).

## #15012 Agent writes a workflow script the runtime executes (2026-08-17, 0 comments)
- Opposite shape: JS script at `.orca/workflows/<name>.js` (project) or `~/.orca/workflows/<name>.js` (personal); globals `meta{name,description,phases}`, `phase()`, `agent(prompt,{schema,agent,model,effort,interactive})`, `parallel()`, `log`, `args`. Control flow is plain JS; non-LLM runtime.
- `agent()` = headless one-shot CLI (`claude -p`, `codex exec`, `agent -p`), stdout JSON as result; opt-in `{interactive:true}` -> terminal worker. Provenance = Run-scoped step record, not a Dispatch.
- Visibility: run view listing phases running/skipped/done; explicitly "not a canvas".
- Compatibility notes: optional RPC fields only, no new opcode; Windows no bash-only runner; SSH cwd on host that owns workspace; no new cross-host scheduler.
- Modeled on Claude Code Workflows (code.claude.com/docs/en/workflows).

## Related (from research agent): #9712 team presets (role -> agent/model), #16073 Agent Office spatial view, #13628 group chat, #15119 Council voting, #9815 AI task decomposition with DAG cycle validation + human gate, #9810 Agent-Orchestrator Protocol.
