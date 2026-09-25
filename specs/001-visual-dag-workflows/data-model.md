# Data Model: Visual DAG Workflows

Types shared by host, renderer, CLI and mobile live under `src/shared/workflows/` and must stay
React Native safe (no `node:` or `electron` imports). Persistence is the existing orchestration
SQLite database (schema version 41 → 42) plus the workflow file on disk.

## 1. Workflow definition (file, `orca-workflows/<name>.workflow.yaml`)

```
Workflow
  version: 1
  name: string (unique per project; file name stem)
  description?: string
  concurrencyLimit?: number (default 4 when omitted; overridable per run)
  workspacePolicy: 'run-workspace' | 'in-place'      # in-place is forced for folder workspaces
  roles: Record<roleId, Role>
  nodes: Node[]
  edges: Edge[]
  layout: Record<nodeId, { x: number; y: number }>
```

### Role
```
Role
  id: string
  name: string
  agent: TuiAgent id
  model?: string
  effort?: string
  systemPrompt: string
  skills: SkillReference[]
  origin?: { source: string; version: string; importedAt: ISO date; localModified: boolean }
```

### SkillReference
```
SkillReference
  name: string
  source: { kind: 'plugin'; plugin: string } | { kind: 'repository'; location: string; version?: string }
  required: boolean (default true)
```
Validation: a `repository` source must match an entry in the project allowlist at import, save
and run (FR-015a).

### Node (discriminated by `type`)
```
NodeBase   id, type, title, position (in layout), notes?
StartNode  type 'start' (exactly one)
EndNode    type 'end' (one or more)
AgentNode  type 'agent'
  roleId?: string
  overrides?: Partial<Pick<Role,'agent'|'model'|'effort'|'systemPrompt'>> & { skills?: SkillReference[] }
  prompt: string                      # may reference ${objective}, ${upstream.<nodeId>.result.<path>}, ${upstream.<nodeId>.artifacts}
  workspace: 'run' | 'child'
  resultContract: JsonSchema           # object schema
  artifacts: { path: string; required: boolean }[]
  question: { timeoutMs: number; escalationGraceMs: number }
RouterNode type 'router'
  roleId / overrides / prompt as AgentNode; result contract fixed to { choice: string; reason: string }
  choices: string[]                    # one outgoing edge per choice
LoopNode   type 'loop'
  body: { nodeIds: string[] }          # contained nodes; only place cycles are allowed
  entryNodeId, exitNodeId
  maxIterations: number (>= 1, required)
  exitCondition: Condition             # over exitNode result
  onCapReached: 'fail'                 # v1 fixed
JoinNode   type 'join'
  policy: 'all' | 'any' | { quorum: number }
  onFailure: 'fail' | 'skip' | 'partial'
ApprovalNode type 'approval'
  question: string
  options: string[]                    # each option = one outgoing edge label
  timeoutMs, escalationGraceMs, defaultOption?: string
ReflectionNode type 'reflection'
  roleId / overrides / prompt; result contract fixed to { proposals: RoleProposal[] }
```

### Edge
```
Edge
  id, from: nodeId, to: nodeId
  fromPort?: string                    # approval option, router choice, loop 'body' | 'exit'
  condition?: Condition
```

### Condition
```
Condition = { path: string; op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'truthy'|'falsy'|'contains'|'lengthGt'; value?: JSON }
          | { all: Condition[] } | { any: Condition[] } | { not: Condition }
```
Evaluated only against the source node's structured result (FR-027). No expression language.

### Graph validation rules (editor and host, same module)
- Exactly one Start; at least one End; every node reachable from Start.
- No cycle in the graph formed by edges whose endpoints are not both inside the same Loop body.
- Loop: `maxIterations` present; entry and exit nodes inside body; body nodes have no edges to
  nodes outside the loop except through the loop's ports.
- Join: at least two incoming edges; quorum ≤ incoming count.
- Approval and Router: every option/choice has exactly one outgoing edge; no other edges.
- Agent nodes with a role whose agent lacks model support cannot set model/effort overrides.
- Every referenced roleId exists; every repository skill source is allowlisted.
- Child workspace disallowed when `workspacePolicy` is `in-place`.

## 2. Project configuration (`orca.yaml`)

```
workflows:
  directory?: string            # default 'orca-workflows'
  allowedSources: string[]      # repository locations approved for roles and skills
```

## 3. Run-time entities (SQLite, orchestration.db v42)

### workflow_runs
| column | type | notes |
|---|---|---|
| id | TEXT PK | `wfr_…` |
| workflow_name | TEXT | |
| workflow_source | TEXT | 'project' \| 'personal' |
| workflow_snapshot | TEXT | full definition JSON at start (FR-022) |
| workflow_version | TEXT | content hash |
| objective | TEXT | |
| repo_id / worktree_id | TEXT | run workspace |
| orchestration_run_id | TEXT | FK runs.id (engine-owned) |
| state | TEXT CHECK | queued \| running \| paused \| waiting \| completed \| failed \| cancelled |
| concurrency_limit | INTEGER | |
| started_by_client | TEXT | |
| created_at / started_at / finished_at | INTEGER | |
| rerun_of_run_id / rerun_from_node_id | TEXT | |

### workflow_node_attempts
| column | notes |
|---|---|
| id | `wfa_…` |
| run_id | FK workflow_runs |
| node_id, node_type | from snapshot |
| iteration | 0 for non-loop nodes |
| attempt_index | rerun/retry counter |
| task_id | FK tasks (agent/router/reflection/approval nodes) |
| dispatch_id | FK dispatch_contexts (nullable until dispatched) |
| state | pending \| provisioning \| running \| waiting \| completed \| failed \| skipped \| cancelled \| unverifiable |
| requested_launch / effective_launch | JSON {agent, model, effort} |
| brief_path, result_path | workspace-relative |
| result_json | validated structured value |
| artifacts_json | [{path, exists}] |
| failure_reason | text |
| workspace_worktree_id | run or child |
| transcript_ref | JSON {kind:'dispatch'\|'session', id} |
| started_at / finished_at | |

### workflow_run_events
Timestamped transitions for the run view and history (closes the orca-viz complaint that
status changes are not timestamped): `id, run_id, attempt_id?, kind, payload_json, created_at`.

### workflow_run_questions
| column | notes |
|---|---|
| id | |
| run_id, attempt_id | |
| kind | 'approval' \| 'agent-question' \| 'trust' |
| gate_id? / question_message_id? | link to decision_gates or messages |
| prompt, options_json | |
| state | pending \| answered \| escalated \| expired |
| answer, answered_by, answered_at | |
| timeout_at, escalation_at | |

### workflow_run_messages
Follow-ups: `id, run_id, attempt_id, sender, text, mode ('queued'|'interrupt'), state (queued|delivered|failed), created_at, delivered_at`.

### workflow_source_trust
Per host: `source TEXT PK, decision ('trusted'|'refused'), decided_by, decided_at`.

### workflow_role_proposals (P3)
`id, run_id, attempt_id, role_id, diff_json, evidence, state (proposed|accepted|exported|rejected)`.

### Columns added to existing tables
- `tasks.workflow_run_id`, `tasks.workflow_node_id`, `tasks.workflow_iteration` (nullable).
- `runs.workflow_run_id` (nullable). Handlers refuse terminal callers on such Runs.
All listed in `VERSIONED_POST_V6_COLUMNS` and `row-column-lists.ts`.

## 4. State machines

### Workflow run
`queued → running ↔ paused; running → waiting (approval/question/trust pending) → running;
running|waiting → completed | failed | cancelled`. Terminal states are final; a rerun creates a
new run referencing `rerun_of_run_id`.

### Node attempt
`pending → provisioning → running → completed | failed`; `running → waiting → running`;
`pending → skipped`; any non-terminal → `cancelled`; `running → unverifiable → running | failed`
(only on positive proof of exit). Mapping to orchestration: `provisioning` = before
`worker-start`; `running` = Dispatch dispatched; `waiting` = pending question/gate;
`completed`/`failed` = `worker_done` outcome plus contract validation.

### Loop
Per iteration: create attempts for body nodes; on exit-node completion evaluate `exitCondition`;
true → follow `exit` port; false and `iteration + 1 < maxIterations` → next iteration with
previous results exposed as `${loop.previous.<nodeId>}`; otherwise loop fails.

### Join
Track incoming edge outcomes: completed, failed, skipped. `all`: every incoming completed or
skipped; `any`: first completed; `quorum(n)`: n completed. `onFailure`: `fail` → join fails
when any incoming fails; `skip` → failed branches count as skipped; `partial` → proceed when
policy satisfied, exposing `${join.branches}` with per-branch outcome.

## 5. Identity and uniqueness
- Workflow name unique within a source (project or personal); project wins on clash.
- Node ids unique within a workflow; stable across edits (never renumbered by layout).
- Run ids, attempt ids and question ids are ULID-style strings generated on the host.
