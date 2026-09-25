import type Database from '../../../../sqlite/sync-database'

// The workflow_* tables (migrate-v42-workflow-tables.ts) are queried with hand-written SQL whose
// projection is only known to the caller; node:sqlite returns untyped rows. Centralizing the two
// casts here keeps every store's SELECT free of its own unaudited `as Row` assertion.

/** Narrows a `.get()` result to `T`; callers supply `T` matching the SELECT's own column list. */
export function selectWorkflowRow<T>(
  db: Database.Database,
  sql: string,
  ...params: Database.BindValue[]
): T | undefined {
  const row = db.prepare(sql).get(...params)
  if (row === undefined) {
    return undefined
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: T is supplied by the call site to match its SELECT against the workflow_* schema (data-model.md §3); node:sqlite returns untyped columns.
  return row as T
}

/** Narrows an `.all()` result to `T[]`; see `selectWorkflowRow`. */
export function selectWorkflowRows<T>(
  db: Database.Database,
  sql: string,
  ...params: Database.BindValue[]
): T[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: T is supplied by the call site to match its SELECT against the workflow_* schema (data-model.md §3); node:sqlite returns untyped columns.
  return db.prepare(sql).all(...params) as T[]
}
