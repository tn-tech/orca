import React from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { WorkflowEditorSessionStatus } from './workflow-editor-session-types'

export type WorkflowEditorPlaceholderProps = {
  status: Exclude<WorkflowEditorSessionStatus, 'ready'>
  loadError: string | null
  noActiveProjectReason: string | undefined
  onAddProject: () => void
}

/** What the editor area shows before a workflow is ready: no project, nothing open, loading, or
 *  a load error. Split out of `WorkflowsPage.tsx` to keep that file under the line budget. */
export default function WorkflowEditorPlaceholder({
  status,
  loadError,
  noActiveProjectReason,
  onAddProject
}: WorkflowEditorPlaceholderProps): React.JSX.Element {
  if (status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        {translate('auto.components.workflows.WorkflowsPage.loading', 'Loading…')}
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-destructive">
        {loadError}
      </div>
    )
  }
  if (noActiveProjectReason) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
        <p>{noActiveProjectReason}</p>
        <Button type="button" size="sm" onClick={onAddProject}>
          {translate('auto.components.workflows.WorkflowsPage.addProjectAction', 'Add a project')}
        </Button>
        <p className="text-xs">
          {translate(
            'auto.components.workflows.WorkflowsPage.selectProjectHint',
            'Or select an existing project from the sidebar.'
          )}
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {translate(
        'auto.components.workflows.WorkflowsPage.placeholder',
        'Select a workflow, or create a new one.'
      )}
    </div>
  )
}
