import type { OrchestrationDb } from '../orchestration-db'
import { createWorkflowTablesSql } from './migrate-v42-workflow-tables'

export function migrateV42(this: OrchestrationDb, current: number): void {
  if (current >= 42) {
    return
  }
  if (!this.hasColumn('tasks', 'workflow_run_id')) {
    this.db.exec('ALTER TABLE tasks ADD COLUMN workflow_run_id TEXT')
  }
  if (!this.hasColumn('tasks', 'workflow_node_id')) {
    this.db.exec('ALTER TABLE tasks ADD COLUMN workflow_node_id TEXT')
  }
  if (!this.hasColumn('tasks', 'workflow_iteration')) {
    this.db.exec('ALTER TABLE tasks ADD COLUMN workflow_iteration INTEGER')
  }
  if (!this.hasColumn('runs', 'workflow_run_id')) {
    this.db.exec('ALTER TABLE runs ADD COLUMN workflow_run_id TEXT')
  }
  this.db.exec(createWorkflowTablesSql())
  this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_workflow_run ON tasks(workflow_run_id);')
}
