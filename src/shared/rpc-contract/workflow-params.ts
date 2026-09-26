import { z } from 'zod'
import { WorkflowSchema } from '../workflows/workflow-definition-schema'
import { OptionalString, requiredString } from './rpc-param-primitives'

// Why: only the routing identifiers (repo, name, source-of-role) are required; every other field
// is optional so later units can add validation without breaking a caller that omits them.
export const WorkflowSource = z.enum(['project', 'personal'])

export const WorkflowList = z
  .object({
    repo: requiredString('Missing repo selector')
  })
  .strict()

export const WorkflowRead = z
  .object({
    repo: requiredString('Missing repo selector'),
    name: requiredString('Missing workflow name'),
    source: WorkflowSource.optional()
  })
  .strict()

export const WorkflowWrite = z
  .object({
    repo: requiredString('Missing repo selector'),
    name: requiredString('Missing workflow name'),
    source: WorkflowSource.optional(),
    // WorkflowSchema, not WorkflowFileSchema: this carries an already-parsed Workflow (its roles
    // have `id`), not raw file-text shape.
    definition: WorkflowSchema.optional(),
    expectedRevision: OptionalString
  })
  .strict()

export const WorkflowValidate = z
  .object({
    repo: requiredString('Missing repo selector'),
    definition: WorkflowSchema.optional()
  })
  .strict()

export const WorkflowDelete = z
  .object({
    repo: requiredString('Missing repo selector'),
    name: requiredString('Missing workflow name'),
    source: WorkflowSource.optional()
  })
  .strict()

export const WorkflowDuplicate = z
  .object({
    repo: requiredString('Missing repo selector'),
    name: requiredString('Missing workflow name'),
    source: WorkflowSource.optional(),
    newName: OptionalString
  })
  .strict()

export const WorkflowImportRole = z
  .object({
    repo: requiredString('Missing repo selector'),
    source: requiredString('Missing role source'),
    roleName: requiredString('Missing role name'),
    version: OptionalString
  })
  .strict()

export const WorkflowDraft = z
  .object({
    repo: requiredString('Missing repo selector'),
    objective: OptionalString
  })
  .strict()
