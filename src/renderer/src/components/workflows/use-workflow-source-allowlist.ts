import { useEffect, useState } from 'react'
import { checkRuntimeHooks } from '@/runtime/runtime-hooks-client'
import type { RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'

/**
 * The project's repository-source allowlist (FR-015a) for workflow roles/skills, read from
 * `orca.yaml`'s `workflows.allowedSources` on the repo's execution host via the same hook check
 * every other `orca.yaml` reader uses (`checkRuntimeHooks`, backed by `register-worktree-hook-
 * check-handler.ts` locally and `workflow-orca-yaml-config.ts` on the engine side — same file,
 * same block).
 *
 * `undefined` means "not known yet" — still loading, or the read failed — and must be treated as
 * unknown, never as an empty allowlist: `SkillSourceBadge`/`isRepositoryAllowlisted` already read
 * `undefined` that way (no flag), whereas `[]` would flag every repository-sourced skill as
 * disallowed even when the real allowlist admits it.
 */
export function useWorkflowSourceAllowlist(
  settings: RuntimeWorkflowSettings,
  repoId: string | undefined
): readonly string[] | undefined {
  const [allowlistedSources, setAllowlistedSources] = useState<readonly string[] | undefined>()

  useEffect(() => {
    setAllowlistedSources(undefined)
    if (!repoId) {
      return
    }
    let ignore = false
    checkRuntimeHooks(settings, repoId)
      .then((result) => {
        if (!ignore) {
          setAllowlistedSources(result.hooks?.workflows?.allowedSources)
        }
      })
      .catch(() => {
        // Best-effort: stays unknown (undefined) rather than falling back to an empty allowlist.
      })
    return () => {
      ignore = true
    }
  }, [repoId, settings])

  return allowlistedSources
}
