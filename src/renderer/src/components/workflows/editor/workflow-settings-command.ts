import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'

/** Workflow-level fields editable without a node selected; `undefined` clears an optional field. */
export type WorkflowSettingsPatch = {
  workspacePolicy?: Workflow['workspacePolicy']
  concurrencyLimit?: number | undefined
}

/** Applies `patch`, dropping cleared optional keys so the saved file omits them (the default). */
export function updateWorkflowSettingsInDefinition(
  definition: Workflow,
  patch: WorkflowSettingsPatch
): Workflow {
  const next: Workflow = { ...definition }
  if (patch.workspacePolicy !== undefined) {
    next.workspacePolicy = patch.workspacePolicy
  }
  if ('concurrencyLimit' in patch) {
    if (patch.concurrencyLimit === undefined) {
      delete next.concurrencyLimit
    } else {
      next.concurrencyLimit = patch.concurrencyLimit
    }
  }
  return next
}
