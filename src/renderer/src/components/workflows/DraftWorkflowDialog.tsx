import React, { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import type { WorkflowDraftResult } from '@/runtime/runtime-workflow-client'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'

export type DraftWorkflowDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Calls `workflow.draft` (US6 AS1); the caller owns the RPC (repo/settings live there). */
  onDraft: (objective: string) => Promise<WorkflowDraftResult>
  /** Loads the drafted definition into the editor as an unsaved draft. */
  onOpenDraft: (definition: Workflow) => void
}

/** US6: describe an objective, let a planning agent propose a workflow, review any problems it
 *  flagged, then open the result in the editor as a draft (not written to disk until saved). */
export default function DraftWorkflowDialog({
  open,
  onOpenChange,
  onDraft,
  onOpenDraft
}: DraftWorkflowDialogProps): React.JSX.Element {
  const objectiveId = useId()
  const [objective, setObjective] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [unsupported, setUnsupported] = useState(false)
  const [result, setResult] = useState<WorkflowDraftResult | null>(null)
  // The planner may keep running server-side briefly even after the user walks away from this
  // dialog (there is no cancel RPC yet); once closed, its eventual result must not reach into the
  // editor. Reset on reopen so a later draft this same instance requests isn't dropped too.
  const abandonedRef = useRef(false)
  useEffect(() => {
    abandonedRef.current = !open
  }, [open])

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const trimmed = objective.trim()
    if (!trimmed) {
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      const draftResult = await onDraft(trimmed)
      if (abandonedRef.current) {
        return
      }
      if (draftResult.definition && draftResult.problems.length === 0) {
        onOpenDraft(draftResult.definition)
        onOpenChange(false)
      } else {
        setResult(draftResult)
      }
    } catch (err) {
      if (abandonedRef.current) {
        return
      }
      if (hasRuntimeRpcErrorCode(err, 'method_not_found')) {
        setUnsupported(true)
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setSubmitting(false)
    }
  }

  function handleOpenAnyway(): void {
    if (!result?.definition) {
      return
    }
    onOpenDraft(result.definition)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate(
                  'auto.components.workflows.DraftWorkflowDialog.reviewTitle',
                  'Review before opening'
                )}
              </DialogTitle>
              <DialogDescription>
                {result.definition
                  ? translate(
                      'auto.components.workflows.DraftWorkflowDialog.reviewDescription',
                      'The planner flagged the following. You can fix them once the draft is open.'
                    )
                  : translate(
                      'auto.components.workflows.DraftWorkflowDialog.reviewDescriptionNoDefinition',
                      "The planner didn't produce a workflow that could be opened."
                    )}
              </DialogDescription>
            </DialogHeader>
            <ul className="scrollbar-sleek max-h-64 space-y-1.5 overflow-y-auto py-2">
              {result.problems.map((problem) => (
                <li
                  key={`${problem.code}-${problem.nodeId ?? ''}-${problem.edgeId ?? ''}-${problem.roleId ?? ''}-${problem.message}`}
                  className="flex items-start gap-2 text-xs"
                >
                  {problem.severity === 'error' ? (
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-annotation-highlight" />
                  )}
                  <span className="text-foreground">{problem.message}</span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setResult(null)}>
                {translate('auto.components.workflows.DraftWorkflowDialog.back', 'Back')}
              </Button>
              {result.definition ? (
                <Button type="button" onClick={handleOpenAnyway}>
                  {translate(
                    'auto.components.workflows.DraftWorkflowDialog.openInEditor',
                    'Open in editor'
                  )}
                </Button>
              ) : null}
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)}>
            <DialogHeader>
              <DialogTitle>
                {translate(
                  'auto.components.workflows.DraftWorkflowDialog.title',
                  'Draft from objective'
                )}
              </DialogTitle>
              <DialogDescription>
                {translate(
                  'auto.components.workflows.DraftWorkflowDialog.description',
                  'Describe what the workflow should accomplish. A planning agent proposes nodes, roles and edges to start from.'
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1 py-4">
              <Label htmlFor={objectiveId}>
                {translate(
                  'auto.components.workflows.DraftWorkflowDialog.objectiveLabel',
                  'Objective'
                )}
              </Label>
              <Textarea
                id={objectiveId}
                autoFocus
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                placeholder={translate(
                  'auto.components.workflows.DraftWorkflowDialog.objectivePlaceholder',
                  'e.g. Triage new support tickets and draft a reply for review.'
                )}
                className="min-h-24"
                disabled={submitting || unsupported}
              />
              {unsupported ? (
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'auto.components.workflows.DraftWorkflowDialog.methodNotSupported',
                    "Drafting a workflow from an objective isn't supported by this host yet."
                  )}
                </p>
              ) : submitting ? (
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'auto.components.workflows.DraftWorkflowDialog.submittingHint',
                    'This can take several minutes. Closing this dialog discards this draft — the planner may keep running briefly.'
                  )}
                </p>
              ) : error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {submitting
                  ? translate('auto.components.workflows.DraftWorkflowDialog.close', 'Close')
                  : translate('auto.components.workflows.DraftWorkflowDialog.cancel', 'Cancel')}
              </Button>
              <Button
                type="submit"
                disabled={submitting || unsupported || objective.trim().length === 0}
              >
                {submitting ? <Loader2 className="animate-spin" /> : null}
                {translate(
                  'auto.components.workflows.DraftWorkflowDialog.submit',
                  'Draft workflow'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
