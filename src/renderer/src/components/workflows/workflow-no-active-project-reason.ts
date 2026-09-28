import { translate } from '@/i18n/i18n'

/** F6: single source of truth for the "no active project" reason — every `!repoId` guard across
 *  the workflow editor session and page controller surfaces this exact text, however it's shown
 *  (thrown error, toast, inline status, or a disabled-control tooltip). */
export function noActiveProjectReason(): string {
  return translate(
    'auto.components.workflows.WorkflowsPage.noActiveProject',
    'Add or select a project to create workflows.'
  )
}
