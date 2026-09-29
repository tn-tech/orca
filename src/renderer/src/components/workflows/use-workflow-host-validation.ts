import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { workflowValidate, type RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../shared/workflows/workflow-definition-types'

const HOST_VALIDATE_DEBOUNCE_MS = 400

export const HOST_VALIDATION_FAILED_CODE = 'workflow_host_validation_failed'

export type UseWorkflowHostValidationParams = {
  settings: RuntimeWorkflowSettings
  repoId: string | undefined
  definition: Workflow | null
  /** False while local field checks fail: the host would only reject the params. */
  storable: boolean
}

function hostValidationFailed(error: unknown): WorkflowProblem {
  return {
    code: HOST_VALIDATION_FAILED_CODE,
    message: translate(
      'auto.components.workflows.use-workflow-host-validation.failed',
      "Couldn't run the host's checks ({{error}}). Only local checks are shown.",
      { error: error instanceof Error ? error.message : String(error) }
    ),
    // Warning: an unreachable host must not block a Run local validation already cleared (F8).
    severity: 'warning'
  }
}

/** Debounced host re-validation (FR-009): the authoritative check for anything the renderer
 *  can't verify on its own (e.g. the project's skill-source allowlist). */
export function useWorkflowHostValidation({
  settings,
  repoId,
  definition,
  storable
}: UseWorkflowHostValidationParams): WorkflowProblem[] {
  const [hostProblems, setHostProblems] = useState<WorkflowProblem[]>([])

  useEffect(() => {
    if (!definition || !repoId || !storable) {
      setHostProblems([])
      return
    }
    // Why: a slower, earlier request (a stale definition, or a workflow the user has since
    // switched away from) must never overwrite a later one's result once it finally resolves.
    let ignore = false
    const timer = window.setTimeout(() => {
      void workflowValidate(settings, { repo: repoId, definition })
        .then((result) => {
          if (!ignore) {
            setHostProblems(result.problems)
          }
        })
        .catch((error: unknown) => {
          if (!ignore) {
            setHostProblems([hostValidationFailed(error)])
          }
        })
    }, HOST_VALIDATE_DEBOUNCE_MS)
    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [definition, repoId, settings, storable])

  return hostProblems
}
