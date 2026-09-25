# Feature Specification: Visual DAG Workflows

**Feature Branch**: `001-visual-dag-workflows`

**Created**: 2026-09-24

**Status**: Draft

**Input**: User description: "Build a visual DAG for Orca IDE. Humans specify workflow steps that lead to a result. The workflow runs in a separate worktree with an orchestrating main agent that spins sub-agents in parallel or in sequence and coordinates across them. Loops may exist, for example a QA agent that reviews a developer agent's work and sends it back. Each node assigns an agent, a model, a reasoning effort, and the skills the agent should use (for example a planning agent that uses speckit-plan). Workflows must also serve non-coding playbooks such as management consulting or fractional CFO work, must be transportable beyond one laptop, and roles must be importable and improvable across an organisation."

## Prior Art and Decisions Already Taken

Research is recorded in `prior-art/`. The decisions below were accepted by the product owner on
2026-09-23 and are treated as settled inputs to this specification:

1. A deterministic workflow engine inside Orca walks the graph and dispatches agents. The
   "orchestrating main agent" is an optional Router node for judgement calls, not the control loop.
2. Cycles exist only inside a Loop container node. The outer graph is acyclic.
3. Every node declares a machine-readable result contract; edges and loop exits evaluate it.
4. A workflow run gets one workspace by default, shared by its nodes; a node may opt into a child
   workspace for parallel branches.
5. The workflow definition is a file committed to the repository, with a personal copy location.
6. Human approval is an Approval node backed by the existing decision-gate concept.
7. Version 1 scope: editor, engine, live run view, manual trigger. No sub-workflows, no event
   triggers.
8. Canvas rendering uses an established open-source graph library.
9. Roles live in the workflow file and can be imported from external repositories.
10. Skills come from installed agent plugins or from open-source repositories; a role names each
    skill's source.

## Clarifications

### Session 2026-09-24

- Q: When a node finishes, what should its result consist of so the next node can pick up its
  work? → A: Both a structured value matching the node's contract and a list of declared artifact
  paths in the run workspace.
- Q: When an agent inside a running node needs an answer from a person, how should that question
  be handled? → A: Surface it to humans as a question item like an approval: the node goes to
  Waiting, every paired client can answer, and a timeout escalates and then fails the node.
- Q: For skills that install on the host rather than inside the run workspace, such as an agent
  plugin, what should the engine do when a role needs one that is missing? → A: Install it
  automatically after a one-time trust confirmation per source per host, remembered afterwards.
- Q: Should a role be allowed to pull a repository-sourced skill from any address, or only from
  sources the organisation has approved? → A: Only from a committed project allowlist, for
  personal and project workflows alike.
- Q: When a person sends a message to a running node's agent without being asked, how should that
  message reach the agent? → A: Queued by default and delivered at the agent's next checkpoint
  with a best-effort nudge, plus an explicit "interrupt now" action for urgent steering; both are
  recorded on the node attempt.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Draw and run a developer-to-QA workflow (Priority: P1)

A user opens the Workflows view for a project, creates a new workflow, and places two nodes on the
canvas: "Implement" and "Review". They connect Implement to Review. On Implement they pick the
Claude Code agent, the Opus model, and high reasoning effort; on Review they pick the Codex agent,
the GPT-5.6 Terra model, and high reasoning effort. They write a prompt for each node, save, and
press Run with a short objective ("Add CSV export to the reports page"). Orca creates a fresh
workspace for the run, starts the Implement agent, shows the node as running with its live status,
and when Implement reports done, starts Review. When Review reports done the run completes and the
user can open each node's transcript and the workspace diff.

**Why this priority**: This is the smallest workflow that proves the editor, the engine, per-node
agent and model selection, workspace creation, and live status all work together. Everything else
builds on it.

**Independent Test**: Create a two-node workflow, run it against a sample repository, and confirm
both agents ran in order in a new workspace with the chosen agent and model, and that the run view
showed each node's status transitions.

**Acceptance Scenarios**:

1. **Given** a project with the Workflows view open, **When** the user adds two nodes, connects
   them, assigns agent, model and effort to each, and saves, **Then** the workflow is stored in the
   repository and re-opens with the same nodes, edges and settings.
2. **Given** a saved two-node workflow, **When** the user presses Run with an objective, **Then** a
   new workspace is created for the run, the first node starts within the agent's normal launch
   time, and the second node does not start until the first reports completion.
3. **Given** a running workflow, **When** a node's agent reports completion, **Then** the node shows
   Completed with the agent's summary, and the next node shows Running.
4. **Given** a node whose agent supports model selection, **When** the run starts that node,
   **Then** the run view shows both the requested and the effective model and effort.
5. **Given** a node whose agent does not support model selection, **When** the user opens the node
   settings, **Then** the model and effort controls are disabled with an explanation, and the run
   uses the agent's own default.

---

### User Story 2 - Bounded review loop (Priority: P1)

The user wraps Implement and Review in a Loop node. The Review node's result contract has an
`approved` field and a `findings` list. The loop's exit condition is "approved is true", and its
maximum iteration count is 3. On each iteration where Review is not approved, Implement runs again
and receives the findings from the previous Review in its prompt context. When Review approves, the
loop exits and the workflow proceeds to any downstream node. If the cap is reached without
approval, the loop ends in a Failed state and the run stops at that point with the last findings
visible.

**Why this priority**: The developer-to-QA loop is the motivating example and the main thing the
existing orchestration engine cannot do today.

**Independent Test**: Run a Loop with a Review node scripted to reject twice and approve on the
third pass. Confirm three iterations ran, Implement received the prior findings each time, the loop
exited on approval, and the iteration counter and per-iteration results are visible in the run
view. Repeat with a Review that never approves and confirm the run stops after the cap with a
Failed loop.

**Acceptance Scenarios**:

1. **Given** a Loop containing Implement and Review with cap 3 and exit condition on the Review
   result, **When** Review reports not approved, **Then** Implement runs again with the previous
   findings available, and the iteration counter increments.
2. **Given** the same loop, **When** Review reports approved, **Then** the loop exits, no further
   iteration starts, and downstream nodes become eligible.
3. **Given** the same loop, **When** the cap is reached without approval, **Then** the loop is
   marked Failed, the run stops, and the last findings are shown on the loop node.
4. **Given** a Loop node, **When** the user tries to save it without a maximum iteration count,
   **Then** the editor blocks saving and explains that every loop needs a cap.
5. **Given** the editor, **When** the user draws an edge that would create a cycle outside a Loop
   node, **Then** the editor refuses the edge and offers to wrap the nodes in a Loop.

---

### User Story 3 - Parallel and conditional branches with a join (Priority: P2)

The user fans out from a Plan node to three implementation nodes that each work in their own child
workspace, then joins them into an Integrate node. The Join waits for all three by default. The
user can change the join policy to continue when any one branch finishes, or to continue with
partial results if a branch fails. Each parallel node runs concurrently up to a per-run concurrency
limit.

The user also adds a Router node after Plan whose agent decides, from the plan, whether the work
is a "bugfix" or a "feature", and connects one outgoing edge per choice. The run follows only the
chosen edge, and the run view shows the choice and the reason the agent gave.

**Why this priority**: Parallel work in isolated workspaces is Orca's core strength and the main
reason to draw a graph rather than a list.

**Independent Test**: Run a fan-out of three nodes into a Join with wait-all. Confirm all three ran
concurrently in separate child workspaces and the Join node started only after the last one. Fail
one branch and confirm the Join behaves per its policy.

**Acceptance Scenarios**:

1. **Given** three nodes downstream of one node, **When** the upstream node completes, **Then** all
   three start concurrently, subject to the run's concurrency limit.
2. **Given** a Join with wait-all, **When** two of three branches complete, **Then** the Join stays
   Waiting until the third completes.
3. **Given** a Join with policy "fail on any failure", **When** one branch fails, **Then** the Join
   fails, and remaining branches are asked to stop.
4. **Given** a Join with policy "continue with partial results", **When** one branch fails,
   **Then** the Join proceeds once the others complete, and the downstream node sees which branches
   succeeded.
5. **Given** a node marked "child workspace", **When** it runs, **Then** it gets its own workspace
   derived from the run workspace, and the run view shows which workspace each node used.
6. **Given** a Router node with choices "bugfix" and "feature", **When** its agent reports the
   choice "feature", **Then** only the edge labelled "feature" fires, the "bugfix" branch is marked
   Skipped, and the recorded reason is visible on the Router node.
7. **Given** a Router node, **When** its agent reports a choice that is not one of the configured
   choices, **Then** the node fails with the raw result visible and no outgoing edge fires.

---

### User Story 4 - Roles with skills, imported and auto-provisioned (Priority: P2)

A consulting firm keeps a repository of roles such as "Engagement Manager" and "Financial Model
Reviewer". Each role names an agent, a model, a reasoning effort, a system prompt, and the skills it
needs, with each skill's source: either an installed agent plugin by name or a public repository
URL. In the workflow editor the user imports a role from that repository into the workflow file,
assigns it to a node, and optionally overrides the model or adds a skill for that node only. When
the run starts, Orca checks whether each required skill is available in the run's workspace on the
machine that executes the node, installs any that are missing from the named source, and tells the
agent which skills to use.

**Why this priority**: Non-coding workflows are defined by their skills. Without roles and
automatic skill provisioning a workflow cannot be shared between teams or machines.

**Independent Test**: Import a role from a test repository whose skill list includes one plugin
skill and one repository skill neither of which is installed. Run a one-node workflow using the
role. Confirm both skills were installed into the run workspace before the agent started, the
agent's starting prompt names them, and the run view shows the provisioning steps and their
results.

**Acceptance Scenarios**:

1. **Given** a role repository URL, **When** the user imports a role, **Then** the role's
   definition is copied into the workflow file with a record of its origin and version.
2. **Given** a node assigned a role, **When** the user overrides the model, **Then** the node shows
   the override distinctly from the role default, and reverting restores the role default.
3. **Given** a role whose skills are not installed, **When** a run starts a node with that role,
   **Then** the missing skills are installed for the run workspace before the agent launches, and
   the node shows a Provisioning state while this happens.
4. **Given** a skill that cannot be installed, **When** provisioning fails, **Then** the node fails
   before the agent starts, the reason is shown, and no agent is launched.
4a. **Given** a role naming a plugin-sourced skill not installed on the executing host, **When** a
   run reaches a node with that role for the first time on that host, **Then** the node waits for
   a person to trust the source, and after approval the plugin is installed and remembered so the
   next run on that host does not ask.
5. **Given** a node whose agent has no supported skill location, **When** the user assigns a role
   with skills, **Then** the editor warns that the agent cannot load skills from the workspace and
   the run falls back to including the skill instructions in the prompt.
6. **Given** a workflow file with roles, **When** the file is opened on another machine, **Then**
   the roles resolve identically with no dependency on the original machine.

---

### User Story 5 - Human approval and agent questions inside a run (Priority: P2)

The user adds an Approval node between Plan and Implement with the question "Approve the plan?"
and options Approve and Reject. When the run reaches it, the run pauses at that node, the question
appears in the run view, in Orca's notifications, and on the mobile companion. Any paired client
can answer. Approve continues; Reject follows the rejection edge if one exists or stops the run. An
Approval node has a timeout after which it escalates by notification and, if still unanswered,
follows a configured default.

Separately, while the Implement node is running, its agent hits a decision it cannot make alone
and asks a question. The question appears in the same places as an approval, the node shows
Waiting, and the first person to answer from any paired client unblocks the agent, which
continues in the same session with the answer.

**Why this priority**: Human checkpoints are what make automated multi-agent runs acceptable for
client-facing deliverables.

**Independent Test**: Run a workflow with an Approval node, answer it from the mobile companion,
and confirm the run continued along the chosen edge. Let a second run time out and confirm the
escalation and default behaviour.

**Acceptance Scenarios**:

1. **Given** a run reaching an Approval node, **When** the node activates, **Then** the run
   pauses, the question is visible on all paired clients, and no downstream node starts.
2. **Given** a pending approval, **When** any authorised client answers, **Then** the run resumes
   along the edge matching the answer, and the run view records who answered and when.
3. **Given** a pending approval with a timeout, **When** the timeout elapses, **Then** an
   escalation notification is sent, and after the configured grace the default answer applies.
4. **Given** an Approval node inside a Loop, **When** the loop iterates, **Then** the approval is
   asked on each iteration.
5. **Given** a running node whose agent asks a question, **When** the question is raised,
   **Then** the node shows Waiting, the question appears on every paired client with the agent's
   context, and no other part of the run is paused.
6. **Given** a pending agent question, **When** a person answers, **Then** the answer reaches the
   agent in its existing session, the node returns to Running, and the run view records the
   question, the answer, the answerer and the time.
6a. **Given** a running node, **When** a person sends a follow-up message, **Then** it is queued
   and shown as Undelivered until the agent's next checkpoint, after which it shows Delivered; and
   **When** the person instead chooses "interrupt now", **Then** the agent receives it immediately
   and the record shows it was an interrupt.
7. **Given** a pending agent question, **When** its timeout elapses, **Then** an escalation
   notification is sent, and after the configured grace the node fails with the unanswered
   question visible.

---

### User Story 6 - Describe a workflow and let an agent draft it (Priority: P3)

Instead of drawing nodes, the user types an objective and asks Orca to draft a workflow. A planning
agent proposes nodes, edges, roles and result contracts, which appear on the canvas as a draft the
user can edit before saving or running.

**Why this priority**: Faster authoring for new users, but the drawn path must exist first.

**Independent Test**: Ask for a draft from a one-paragraph objective and confirm a valid, editable
workflow appears with no cycle outside a Loop and every node fully specified.

**Acceptance Scenarios**:

1. **Given** an objective, **When** the user requests a draft, **Then** a workflow appears on the
   canvas marked as a draft with every node assigned a role or agent.
2. **Given** a drafted workflow, **When** the user edits any node and saves, **Then** the draft
   becomes an ordinary saved workflow.

---

### User Story 7 - Reflection node that proposes role improvements (Priority: P3)

A workflow ends with a Reflection node whose agent reviews the run's transcripts and results and
proposes changes to the roles used, such as an added instruction or a new skill. Proposals are
attached to the run, shown as a diff against the role, and can be accepted into the workflow file
or exported as a change proposal to the role's origin repository so the organisation can adopt it.

**Why this priority**: Collective learning across an organisation is a stated goal, but it depends
on roles, runs and results being in place.

**Independent Test**: Run a workflow with a Reflection node and confirm a proposal is produced,
displayed as a diff, and can be accepted locally or exported to the origin repository.

**Acceptance Scenarios**:

1. **Given** a completed run with a Reflection node, **When** the node completes, **Then** zero or
   more role proposals are attached to the run, each showing the role, the proposed change, and
   the evidence from the run.
2. **Given** a proposal, **When** the user accepts it, **Then** the role in the workflow file is
   updated and the change is recorded with the run that produced it.
3. **Given** a proposal for an imported role, **When** the user exports it, **Then** a change
   proposal is prepared against the origin repository using the repository's normal contribution
   flow.

---

### User Story 8 - Run history, rerun and portability (Priority: P3)

The user reviews past runs of a workflow, opens any run to see per-node timing, attempts, results,
and cost where the agent reports it, reruns a failed run from the failed node, and opens the same
workflow on a Remote Orca Server or an SSH-backed project where it runs on that host with the same
behaviour.

**Why this priority**: Operational maturity; needed before workflows are relied on for client
work, but not needed to prove the concept.

**Independent Test**: Run a workflow that fails at its third node, rerun from that node, and
confirm earlier nodes were not re-executed. Open the same workflow file on a remote runtime and
confirm an identical run completes there.

**Acceptance Scenarios**:

1. **Given** a workflow with past runs, **When** the user opens the history, **Then** each run
   shows its start time, outcome, duration, and per-node outcomes.
2. **Given** a failed run, **When** the user reruns from the failed node, **Then** completed
   upstream nodes keep their results and only the failed node and its descendants execute.
3. **Given** a project on a Remote Orca Server, **When** the user runs a workflow from a laptop
   client, **Then** every node executes on the server, the run continues if the laptop
   disconnects, and the laptop shows the current state on reconnection.

---

### Edge Cases

- A node's agent is not installed on the executing host: the node fails at provisioning with a
  clear message and no partial launch.
- The executing host loses contact with the client mid-run: node states show Unverifiable, never
  Exited, until contact resumes; the engine never assumes an agent died from silence.
- The project is a folder workspace with no version control: a run uses a copy or the folder
  itself per the workflow's workspace policy, and child workspaces are unavailable with an
  explanation.
- A Loop reaches its cap: the loop fails, the run stops, and the last iteration's results remain
  visible.
- A Join with wait-all has a branch that was skipped by a condition: the Join treats skipped as
  satisfied, not as pending forever.
- An agent reports done without a result matching the node's contract: the node fails with the
  raw output visible, and the engine does not guess a value.
- Two users edit the same workflow file: the file is plain text under version control, and Orca
  detects an external change and offers reload or overwrite.
- A workflow references a role or skill that no longer exists at its source: the run refuses to
  start and names the missing item.
- A personal workflow uses a skill source that the current project's allowlist does not approve:
  the run refuses to start and names the source, even though the same workflow may run in another
  project that approves it.
- Client and host run different Orca versions: a workflow using node types the host does not
  understand refuses to start with a version message, and older clients ignore unknown optional
  fields.
- A run is cancelled: every live agent is asked to stop, states are recorded, and the run is
  marked Cancelled rather than Failed.
- Two workflows run concurrently in the same project: each has its own workspace and run record
  and they do not share concurrency limits unless configured.

## Requirements *(mandatory)*

### Functional Requirements

**Editor**

- **FR-001**: Users MUST be able to create, open, edit, save, duplicate and delete workflows from
  a Workflows view scoped to a project.
- **FR-002**: The canvas MUST support Agent, Router, Loop, Join, Approval, Reflection, Start and
  End node types, with edges drawn between compatible ports.
- **FR-003**: Each Agent node MUST let the user set: display name, role (optional), agent, model,
  reasoning effort, skills, prompt, workspace policy (run workspace or child workspace), result
  contract, and the artifacts it is expected to produce.
- **FR-004**: The editor MUST offer only models and effort levels the selected agent supports, and
  MUST disable model and effort for agents without support, showing why.
- **FR-005**: The editor MUST reject any edge that creates a cycle outside a Loop node.
- **FR-006**: A Loop node MUST require a maximum iteration count and MUST allow an exit condition
  expressed over a contained node's result contract.
- **FR-007**: A Join node MUST have a policy of wait-all, wait-any, or quorum, and a failure policy
  of fail, skip, or continue-with-partial.
- **FR-008**: Edges MAY carry a condition over the source node's result contract; unconditioned
  edges always fire.
- **FR-009**: The editor MUST validate a workflow before save and before run, listing every problem
  with a link to the offending node.
- **FR-010**: The editor MUST auto-layout on request and preserve manual node positions otherwise.

**Workflow file**

- **FR-011**: A workflow MUST be stored as a human-readable text file inside the project so it can
  be committed, reviewed and diffed, with canvas positions included.
- **FR-012**: A personal workflow location outside the project MUST be supported, with the project
  copy taking precedence on a name clash.
- **FR-013**: The workflow file MUST contain the roles it uses, each with the origin and version it
  was imported from where applicable.
- **FR-014**: The file format MUST be versioned so that newer files are refused with a clear
  message by older Orca versions and older files are upgraded by newer versions.

**Roles and skills**

- **FR-015**: A role MUST define an agent, a model, a reasoning effort, a system prompt, and a list
  of skills, each skill naming its source as an installed plugin name or a repository location.
- **FR-015a**: Each project MUST hold a committed allowlist of approved skill and role sources.
  Importing a role, saving a workflow, and starting a run MUST refuse any repository-sourced skill
  or role whose source is not on the allowlist of the project the workflow runs against, naming
  the source and the allowlist location. This applies equally to personal workflows. An empty or
  missing allowlist permits no repository sources.
- **FR-016**: Users MUST be able to import a role from a repository location and re-import to
  update it, with the workflow showing local modifications relative to the imported version.
- **FR-017**: A node assigned a role MUST be able to override any role field, and the editor MUST
  show overrides distinctly.
- **FR-018**: Before an Agent node launches, the engine MUST ensure every required skill is
  available to that agent on the executing host, installing missing skills from their declared
  source through Orca's existing skill installation, and MUST fail the node if provisioning
  fails. Repository-sourced skills are installed at run-workspace scope. Plugin-sourced skills
  are installed at host scope through the agent's own plugin mechanism.
- **FR-018a**: The first time a run needs a host-scope install from a given source on a given
  host, the engine MUST pause the node in Waiting and ask a person to trust that source, showing
  the source, the skills it provides, and the agents affected. A trust decision MUST be remembered
  per source per host, MUST be revocable from settings, and a refusal MUST fail the node without
  installing. Subsequent runs needing the same source on that host MUST proceed without asking.
- **FR-019**: The agent's starting instructions MUST name the skills it is expected to use.
- **FR-020**: For agents that cannot load skills from a workspace, the engine MUST include the
  skill instructions in the prompt and the editor MUST warn the user of the fallback.
- **FR-021**: Skill installations made for a run MUST NOT be added to the project's version control
  history.

**Engine and runs**

- **FR-022**: Starting a run MUST create a run record with the workflow version, objective,
  workspace, start time and the client that started it.
- **FR-023**: The engine MUST execute nodes strictly according to edges, conditions, Loop and
  Join semantics, without any language-model decision in the control path except inside Router
  nodes.
- **FR-024**: Node execution MUST use Orca's existing supervised worker lifecycle so that a run
  appears in every existing reader of agent status and orchestration state.
- **FR-025**: A run MUST get its own workspace by default, created from the project's default
  branch or the folder, and each node MUST run in the run workspace unless it opts into a child
  workspace.
- **FR-026**: The engine MUST record every node attempt with start, end, requested and effective
  agent settings, outcome, result, and a link to the agent's transcript.
- **FR-027**: A node's result MUST consist of a structured value captured against its result
  contract plus a list of declared artifact paths inside the run workspace. A structured value that
  does not satisfy the contract, or a declared artifact that does not exist when the node reports
  done, MUST fail the node with the raw output preserved. Conditions and loop exits evaluate only
  the structured value; downstream nodes receive both the value and the artifact list.
- **FR-028**: Loop iterations MUST expose the previous iteration's results to the nodes of the next
  iteration.
- **FR-029**: A Router node MUST produce a choice among its outgoing edges and MUST record the
  reason given.
- **FR-030**: Users MUST be able to pause, resume and cancel a run, and rerun a failed run from the
  failed node while retaining upstream results.
- **FR-031**: The engine MUST enforce a per-run concurrency limit with a documented default.
- **FR-032**: Node states MUST be exactly: Pending, Provisioning, Running, Waiting, Completed,
  Failed, Skipped, Cancelled, Unverifiable. Waiting covers a pending approval, a pending agent
  question, and a Join awaiting branches. Liveness of a remote agent MUST use the vocabulary
  live, unverifiable, exited.
- **FR-033**: An Approval node MUST pause the run, publish the question to every paired client,
  accept the first authorised answer, record the answerer, support a timeout with escalation and
  a default answer, and work inside Loop nodes.
- **FR-033a**: When a node's agent asks a question, the engine MUST place the node in Waiting,
  publish the question with the agent's context to every paired client, deliver the first
  authorised answer to the agent in its existing session, record question, answer, answerer and
  time on the node attempt, and on timeout escalate by notification and then fail the node. Other
  nodes in the run MUST continue unaffected.
- **FR-034**: A Reflection node MUST produce role change proposals attached to the run, each with
  evidence, and users MUST be able to accept a proposal into the workflow file or export it toward
  the role's origin repository.

**Run view**

- **FR-035**: The run view MUST show live node states on the canvas, the active iteration of each
  Loop, attempts per node, pending approvals, and each node's effective agent, model and effort.
- **FR-036**: Users MUST be able to open a node's transcript, result and workspace diff from the
  run view, and to send a follow-up message to a running node's agent from any paired client.
- **FR-036a**: A follow-up message MUST be queued durably on the node by default and delivered
  to the agent at its next checkpoint with a best-effort nudge. A separate, explicitly labelled
  "interrupt now" action MUST deliver the message immediately as direct input to the agent's
  session. Both kinds MUST be recorded on the node attempt with sender, time, and delivery mode,
  and the run view MUST show whether a queued message has been delivered yet.
- **FR-037**: A workflow's run history MUST list past runs with outcome and duration and allow
  opening any past run.

**Portability and hosts**

- **FR-038**: Every run MUST execute on the host that owns the project workspace: local, SSH
  target, or Remote Orca Server. The engine MUST NOT fall back to local execution when the owning
  host is unreachable.
- **FR-039**: A run on a Remote Orca Server MUST continue while no client is connected, and clients
  MUST see the current state on reconnection.
- **FR-040**: All run state MUST be readable by any paired client, including the mobile companion,
  and approvals MUST be answerable from it.
- **FR-041**: Workflows MUST work for folder workspaces without version control, with child
  workspaces disabled and explained.
- **FR-042**: The feature MUST work on macOS, Linux and Windows with no shell-specific runners.

### Key Entities

- **Workflow**: a named, versioned graph definition owned by a project; holds nodes, edges, roles,
  canvas layout, default concurrency limit, and workspace policy.
- **Node**: a step in the graph with a type (Agent, Router, Loop, Join, Approval, Reflection,
  Start, End), configuration specific to its type, and a result contract.
- **Edge**: a directed connection between two node ports, optionally carrying a condition over the
  source result.
- **Loop**: a container node holding a subgraph, an iteration cap, an exit condition, and
  iteration-carried results.
- **Role**: a reusable agent configuration: agent, model, effort, system prompt, skills; carries
  origin and version when imported.
- **Skill Reference**: a skill name plus its source, either an installed plugin name or a
  repository location, with an optional version.
- **Source Allowlist**: a committed, per-project list of approved repository locations for roles
  and skills; consulted on import, save and run.
- **Workflow Run**: one execution of a workflow version against an objective; owns a workspace, a
  start client, a state, and its node attempts.
- **Node Attempt**: one execution of a node within a run; records timing, requested and effective
  settings, outcome, result (structured value plus artifact list), transcript link, and the
  workspace used.
- **Artifact**: a file or directory path inside the run workspace that a node declares as an
  output; it is listed on the node attempt and offered to downstream nodes and the run view.
- **Approval**: a pending question attached to a node attempt with options, timeout, answer,
  answerer and time. Approvals are raised by Approval nodes; the same entity, without fixed
  options, represents an agent-raised question.
- **Role Proposal**: a suggested change to a role produced by a Reflection node, with evidence and
  acceptance state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with no prior exposure can build and run the two-node developer-to-QA
  workflow in under 10 minutes using only the editor.
- **SC-002**: In a run, the delay between one node reporting completion and its successor starting
  is under 5 seconds, excluding the successor agent's own launch time.
- **SC-003**: 100% of loop runs terminate: either by exit condition or by iteration cap, in every
  test scenario, with no run left waiting forever.
- **SC-004**: A workflow file created on one machine runs on a second machine and on a Remote
  Orca Server with identical node order and outcomes for a deterministic test workflow.
- **SC-005**: Skill provisioning succeeds for a role naming one plugin skill and one repository
  skill on macOS, Linux and Windows, and the agent's transcript shows the skills were used.
- **SC-006**: An approval answered from the mobile companion resumes the run within 5 seconds.
- **SC-007**: Existing orchestration readers (sidebar agent rows, the process list command, the
  mobile session list) show workflow-run agents without any change to those readers.
- **SC-008**: A disconnected client reconnecting after a remote run finished sees the completed run
  with all node results, with no data loss.
- **SC-009**: 90% of validation problems in a workflow are fixed by users on the first attempt,
  measured in usability sessions, because each problem links to its node.

## Constitution Check

- **I. Reuse Before Reimplementing**: the engine is built on the existing Run, Task, Dispatch,
  worker, mailbox and decision-gate lifecycle; skill provisioning uses the existing skill
  installer; the editor is a new top-level view following existing view patterns.
- **II. Every Host Is a First-Class Host**: FR-038 to FR-042 cover SSH, Remote Orca Server,
  folder workspaces and all three desktop platforms; FR-032 fixes the liveness vocabulary.
- **III. Evidence Over Assumption**: FR-026 and FR-027 make every attempt and result recorded and
  contract-checked; any agent screen reading needed for readiness follows the transcript rule.
- **IV. One Owner Per Fact**: FR-024 keeps agent status in the existing store; the run record is
  the single owner of workflow state and every view subscribes to it.
- **V. Compatibility Is a Contract**: FR-014 versions the file format; the edge case on mixed
  versions requires optional fields and capability checks before forwarding node settings.
- **VI. Upstream Baseline**: the feature is additive; it changes no upstream library choice and
  isolates itself in new modules, a new view and optional fields.

## Assumptions

- The orchestrating "main agent" from the original brief is realised as the deterministic engine
  plus optional Router nodes, per accepted decision 1.
- A Loop that reaches its cap fails the run at that point rather than continuing with the last
  result. This can be made configurable later.
- The default Join policy is wait-all with failure policy fail. Skipped branches count as
  satisfied.
- Any paired client authenticated to the runtime may answer an approval; finer-grained authorisation
  is left to the shared-sessions feature.
- The default per-run concurrency limit follows the existing nested-worker and wave guidance in the
  orchestration skill and is configurable per workflow.
- Result contracts are expressed as JSON-shaped schemas the agent is asked to satisfy; how an agent
  is made to emit them is a planning concern.
- Roles imported from a repository are copied into the workflow file; the file is the single source
  at run time and no network access is needed to run.
- Skills from "model plugins" means skills shipped with an installed agent CLI or its plugin
  system, addressed by name and installed at host scope; skills from repositories are addressed by
  location and optional version and installed at run-workspace scope.
- Skill provisioning targets only agents with a documented workspace skill location today; others
  get the prompt fallback in FR-020.
- Event triggers, scheduled triggers and sub-workflows are out of scope for this feature and may
  extend the existing Automations feature later.
- Multi-human shared sessions with presence and input queuing, as in the Conductor product, are a
  separate feature; this feature only guarantees that runs execute on the owning host and that all
  state is readable by any paired client, so that the shared-sessions feature can build on it.
- Mobile support is limited to viewing runs and answering approvals; editing on mobile is out of
  scope.
- Orchestration is currently marked Experimental in Orca; this feature inherits that flag until
  both are considered stable.
