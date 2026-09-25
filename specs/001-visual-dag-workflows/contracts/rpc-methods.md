# Contract: `workflow.*` RPC family

Registered in `src/main/runtime/rpc/methods/workflows/` and listed in `ALL_RPC_METHODS`. Params
schemas are exported from `src/shared/rpc-contract/workflow-params.ts` and
`workflow-run-params.ts` (strict zod objects) so the params catalog generator binds them.
Host capability: `workflow.engine.v1` (`WORKFLOW_ENGINE_RUNTIME_CAPABILITY`).

`worktree` below is the existing worktree selector; `repo` selects a repository or folder root.

## Definitions
| Method | Params | Result |
|---|---|---|
| `workflow.list` | `{ repo }` | `{ workflows: { name, source: 'project'\|'personal', path, description?, valid: boolean }[] }` |
| `workflow.read` | `{ repo, name, source? }` | `{ definition, raw, revision, problems: Problem[] }` |
| `workflow.write` | `{ repo, name, source?, definition, expectedRevision? }` | `{ revision }` (error `workflow_file_conflict` when revision mismatches) |
| `workflow.validate` | `{ repo, definition }` | `{ problems: Problem[] }` |
| `workflow.delete` | `{ repo, name, source? }` | `{}` |
| `workflow.duplicate` | `{ repo, name, source?, newName }` | `{ name, revision }` (error `workflow_name_taken`) |
| `workflow.importRole` | `{ repo, source, roleName, version? }` | `{ role }` (error `workflow_source_not_allowed`) |
| `workflow.draft` (P3) | `{ repo, objective }` | `{ definition, problems }` |

`Problem = { code, message, nodeId?, edgeId?, roleId?, severity: 'error'|'warning' }`.

## Runs
| Method | Params | Result |
|---|---|---|
| `workflow.run.start` | `{ repo, name, source?, objective, overrides?: { concurrencyLimit? } }` | `{ runId }` |
| `workflow.run.list` | `{ repo?, name?, state?, cursor?, limit? }` | `{ runs: RunSummary[], nextCursor? }` |
| `workflow.run.show` | `{ runId }` | `RunSnapshot` (run, attempts, questions, messages, events tail) |
| `workflow.run.pause` / `resume` / `cancel` | `{ runId }` | `{ state }` |
| `workflow.run.rerun` | `{ runId, fromNodeId }` | `{ runId }` |
| `workflow.run.answer` | `{ runId, questionId, answer?: string, optionId?: string }` | `{ state }` |
| `workflow.run.sendMessage` | `{ runId, attemptId, text, mode: 'queued'\|'interrupt' }` | `{ messageId }` |
| `workflow.run.readNodeOutput` | `{ runId, attemptId, cursor?, limit? }` | same shape as `orchestration.workerRead` result |
| `workflow.run.events` | `{ runId, afterSeq?, limit? }` | `{ events, nextSeq }` |

## Trust and proposals
| Method | Params | Result |
|---|---|---|
| `workflow.trust.list` | `{}` | `{ decisions: { source, decision, decidedAt }[] }` |
| `workflow.trust.decide` | `{ source, decision: 'trusted'\|'refused' }` | `{}` |
| `workflow.proposal.accept` (P3) | `{ runId, proposalId }` | `{ revision }` |
| `workflow.proposal.export` (P3) | `{ runId, proposalId }` | `{ exportPath }` |

## Events
- `runtime.clientEvents.subscribe` gains `{ type: 'workflowRunChanged', runId, reason:
  'state'|'attempt'|'question'|'message' }`. Old clients drop it.
- Local IPC `workflows:changed` with the same payload, bridged to a window event like
  `AUTOMATIONS_CHANGED_EVENT`.
- Notification source `workflow-attention` (approval, agent question, trust prompt, run failed,
  run completed), added to `MOBILE_PUSH_SOURCES`.

## Mobile allowlist additions
`workflow.run.list`, `workflow.run.show`, `workflow.run.answer`, `workflow.run.events`.

## Error codes
`workflow_not_found`, `workflow_invalid` (with problems), `workflow_file_conflict`,
`workflow_file_version_unsupported`, `workflow_source_not_allowed`, `workflow_owned_run`
(terminal caller on an engine-owned orchestration Run), `workflow_run_not_active`,
`workflow_question_not_pending`, `workflow_capability_missing`, `workflow_name_taken`,
`workflow_host_unreachable` (run start refused because the owning host cannot be reached; nothing
is created locally).
