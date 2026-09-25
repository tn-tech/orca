import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'

const WORKFLOW_TABLES = [
  'workflow_runs',
  'workflow_node_attempts',
  'workflow_run_events',
  'workflow_run_questions',
  'workflow_run_messages',
  'workflow_source_trust',
  'workflow_role_proposals'
]

function tableExists(db: OrchestrationDb, table: string): boolean {
  return !!db.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
}

// Downgrades a freshly-migrated database to look like a v41 database: drops the workflow tables
// and columns v42 adds, then stamps user_version = 41.
function downgradeToV41(dbPath: string): void {
  const raw = new Database(dbPath)
  raw.exec(`
    DROP TABLE workflow_runs;
    DROP TABLE workflow_node_attempts;
    DROP TABLE workflow_run_events;
    DROP TABLE workflow_run_questions;
    DROP TABLE workflow_run_messages;
    DROP TABLE workflow_source_trust;
    DROP TABLE workflow_role_proposals;
    DROP INDEX idx_tasks_workflow_run;
    ALTER TABLE tasks DROP COLUMN workflow_run_id;
    ALTER TABLE tasks DROP COLUMN workflow_node_id;
    ALTER TABLE tasks DROP COLUMN workflow_iteration;
    ALTER TABLE runs DROP COLUMN workflow_run_id;
  `)
  raw.pragma('user_version = 41')
  raw.close()
}

describe('migrate v41 -> v42 workflow schema', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reaches schema version 42 on a fresh database', () => {
    const db = new OrchestrationDb(':memory:')
    try {
      expect(db.db.pragma('user_version', { simple: true })).toBe(42)
      expect(SCHEMA_VERSION).toBe(42)
      for (const table of WORKFLOW_TABLES) {
        expect(tableExists(db, table)).toBe(true)
      }
    } finally {
      db.close()
    }
  })

  it('adds every workflow table and the nullable linkage columns to a v41 database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-migrate-v42-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'orchestration.db')
    new OrchestrationDb(dbPath).close()
    downgradeToV41(dbPath)

    const db = new OrchestrationDb(dbPath)
    try {
      expect(db.db.pragma('user_version', { simple: true })).toBe(42)
      for (const table of WORKFLOW_TABLES) {
        expect(tableExists(db, table)).toBe(true)
      }
      expect(db.hasColumn('tasks', 'workflow_run_id')).toBe(true)
      expect(db.hasColumn('tasks', 'workflow_node_id')).toBe(true)
      expect(db.hasColumn('tasks', 'workflow_iteration')).toBe(true)
      expect(db.hasColumn('runs', 'workflow_run_id')).toBe(true)
    } finally {
      db.close()
    }
  })

  it('is idempotent: reopening an already-migrated database changes nothing and does not throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-migrate-v42-idempotent-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'orchestration.db')
    const first = new OrchestrationDb(dbPath)
    first.close()

    expect(() => {
      const second = new OrchestrationDb(dbPath)
      second.close()
    }).not.toThrow()

    const db = new OrchestrationDb(dbPath)
    try {
      expect(db.db.pragma('user_version', { simple: true })).toBe(42)
      for (const table of WORKFLOW_TABLES) {
        expect(tableExists(db, table)).toBe(true)
      }
    } finally {
      db.close()
    }
  })

  it('accepts every WORKFLOW_RUN_STATES / WORKFLOW_ATTEMPT_STATES value in the CHECK constraints', () => {
    const db = new OrchestrationDb(':memory:')
    try {
      db.db
        .prepare(
          `INSERT INTO workflow_runs (
             id, workflow_name, workflow_source, workflow_snapshot, workflow_version,
             objective, repo_id, worktree_id, state, created_at
           ) VALUES ('wfr_1', 'demo', 'project', '{}', 'v1', 'obj', 'repo_1', 'wt_1', 'waiting', 1)`
        )
        .run()
      db.db
        .prepare(
          `INSERT INTO workflow_node_attempts (id, run_id, node_id, node_type, state)
           VALUES ('wfa_1', 'wfr_1', 'n1', 'agent', 'unverifiable')`
        )
        .run()
      expect(
        db.db.prepare('SELECT state FROM workflow_runs WHERE id = ?').get('wfr_1')
      ).toMatchObject({ state: 'waiting' })
      expect(
        db.db.prepare('SELECT state FROM workflow_node_attempts WHERE id = ?').get('wfa_1')
      ).toMatchObject({ state: 'unverifiable' })
    } finally {
      db.close()
    }
  })
})
