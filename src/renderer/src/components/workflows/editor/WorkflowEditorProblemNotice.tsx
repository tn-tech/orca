import React from 'react'
import { AlertCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { WorkflowEditorProblem } from './workflow-editor-commands'

export type WorkflowEditorProblemNoticeProps = {
  problem: WorkflowEditorProblem | undefined
  onWrapInLoop: (nodeIds: string[]) => void
  onDismiss: () => void
}

/**
 * Surfaces the last refused editor command (FR-005, US2 AS5: drawing a back-edge outside a Loop)
 * next to the canvas — until now `lastProblem` was set but nothing rendered it. When the refusal
 * names the two nodes a Loop would resolve it (`wrapNodeIds`), offers a one-click "Wrap in Loop".
 */
export default function WorkflowEditorProblemNotice({
  problem,
  onWrapInLoop,
  onDismiss
}: WorkflowEditorProblemNoticeProps): React.JSX.Element | null {
  if (!problem) {
    return null
  }
  const wrapNodeIds = problem.wrapNodeIds

  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive md:px-5"
    >
      <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{problem.message}</span>
      {wrapNodeIds ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onWrapInLoop(wrapNodeIds)}>
          {translate(
            'auto.components.workflows.editor.WorkflowEditorProblemNotice.wrapInLoop',
            'Wrap in Loop'
          )}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onDismiss}
        aria-label={translate(
          'auto.components.workflows.editor.WorkflowEditorProblemNotice.dismiss',
          'Dismiss'
        )}
      >
        <X />
      </Button>
    </div>
  )
}
