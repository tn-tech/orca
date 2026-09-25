import {
  WORKFLOW_ATTEMPT_STATES,
  WORKFLOW_RUN_STATES
} from '../../../../../shared/workflows/workflow-node-states'

function sqlEnum(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ')
}

/**
 * DDL for the v42 workflow_* tables (data-model.md §3). The run/attempt state CHECKs are built
 * from WORKFLOW_RUN_STATES/WORKFLOW_ATTEMPT_STATES so the SQL can never drift from the shared
 * state machine.
 */
export function createWorkflowTablesSql(): string {
  return `
CREATE TABLE IF NOT EXISTS workflow_runs (
  id                    TEXT PRIMARY KEY,
  workflow_name         TEXT NOT NULL,
  workflow_source       TEXT NOT NULL CHECK(workflow_source IN ('project', 'personal')),
  workflow_snapshot     TEXT NOT NULL,
  workflow_version      TEXT NOT NULL,
  objective             TEXT NOT NULL,
  repo_id               TEXT NOT NULL,
  worktree_id           TEXT NOT NULL,
  orchestration_run_id  TEXT,
  state                 TEXT NOT NULL DEFAULT 'queued'
    CHECK(state IN (${sqlEnum(WORKFLOW_RUN_STATES)})),
  concurrency_limit     INTEGER,
  started_by_client     TEXT,
  created_at            INTEGER NOT NULL,
  started_at            INTEGER,
  finished_at           INTEGER,
  rerun_of_run_id       TEXT,
  rerun_from_node_id    TEXT
);

CREATE TABLE IF NOT EXISTS workflow_node_attempts (
  id                     TEXT PRIMARY KEY,
  run_id                 TEXT NOT NULL,
  node_id                TEXT NOT NULL,
  node_type              TEXT NOT NULL,
  iteration              INTEGER NOT NULL DEFAULT 0,
  attempt_index          INTEGER NOT NULL DEFAULT 0,
  task_id                TEXT,
  dispatch_id            TEXT,
  state                  TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN (${sqlEnum(WORKFLOW_ATTEMPT_STATES)})),
  requested_launch       TEXT,
  effective_launch       TEXT,
  brief_path             TEXT,
  result_path            TEXT,
  result_json            TEXT,
  artifacts_json         TEXT NOT NULL DEFAULT '[]',
  failure_reason         TEXT,
  workspace_worktree_id  TEXT,
  transcript_ref         TEXT,
  started_at             INTEGER,
  finished_at            INTEGER
);

CREATE INDEX IF NOT EXISTS idx_workflow_node_attempts_run ON workflow_node_attempts(run_id);

CREATE TABLE IF NOT EXISTS workflow_run_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL,
  attempt_id   TEXT,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_run_events_run ON workflow_run_events(run_id, id);

CREATE TABLE IF NOT EXISTS workflow_run_questions (
  id                  TEXT PRIMARY KEY,
  run_id              TEXT NOT NULL,
  attempt_id          TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK(kind IN ('approval', 'agent-question', 'trust')),
  gate_id             TEXT,
  question_message_id TEXT,
  prompt              TEXT NOT NULL,
  options_json        TEXT NOT NULL DEFAULT '[]',
  state               TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending', 'answered', 'escalated', 'expired')),
  answer              TEXT,
  answered_by         TEXT,
  answered_at         INTEGER,
  timeout_at          INTEGER,
  escalation_at       INTEGER
);

CREATE TABLE IF NOT EXISTS workflow_run_messages (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  attempt_id   TEXT NOT NULL,
  sender       TEXT NOT NULL,
  text         TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK(mode IN ('queued', 'interrupt')),
  state        TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued', 'delivered', 'failed')),
  created_at   INTEGER NOT NULL,
  delivered_at INTEGER
);

CREATE TABLE IF NOT EXISTS workflow_source_trust (
  source     TEXT PRIMARY KEY,
  decision   TEXT NOT NULL CHECK(decision IN ('trusted', 'refused')),
  decided_by TEXT NOT NULL,
  decided_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_role_proposals (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  role_id    TEXT NOT NULL,
  diff_json  TEXT NOT NULL,
  evidence   TEXT,
  state      TEXT NOT NULL DEFAULT 'proposed'
    CHECK(state IN ('proposed', 'accepted', 'exported', 'rejected'))
);
  `
}
