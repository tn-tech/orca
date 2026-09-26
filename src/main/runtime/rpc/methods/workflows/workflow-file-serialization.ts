import { stringify } from 'yaml'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'

/** Drops the `id` the parser injects onto each role from its record key (workflow-definition-schema.ts's
 *  `RolesSchema` transform) — `RoleFileSchema` is `.strict()`, so writing `id` back would fail re-parse. */
function workflowFileRoles(roles: Workflow['roles']): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(roles).map(([roleId, role]) => {
      const { id: _id, ...rest } = role
      return [roleId, rest]
    })
  )
}

/** Renders a parsed `Workflow` back to the `*.workflow.yaml` text `workflow-file-store.ts` persists. */
export function serializeWorkflowFile(definition: Workflow): string {
  return stringify({ ...definition, roles: workflowFileRoles(definition.roles) })
}
