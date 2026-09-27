import React, { useState } from 'react'
import { AlertTriangle, MoreHorizontal, Plus, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { WorkflowDraftResult, WorkflowSummary } from '@/runtime/runtime-workflow-client'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'
import type { WorkflowRunSource } from '../../../../shared/workflows/workflow-run-types'
import type { OpenWorkflowRef } from './use-workflow-editor-session'
import WorkflowNameDialog from './WorkflowNameDialog'
import WorkflowDeleteDialog from './WorkflowDeleteDialog'
import DraftWorkflowDialog from './DraftWorkflowDialog'
import DiscardDraftDialog from './DiscardDraftDialog'

export type WorkflowListPaneProps = {
  rows: readonly WorkflowSummary[]
  loading: boolean
  error: string | null
  selected: OpenWorkflowRef | null
  onOpen: (row: WorkflowSummary) => void
  onCreate: (name: string, source: WorkflowRunSource) => Promise<void>
  onDuplicate: (row: WorkflowSummary, newName: string) => Promise<void>
  onDelete: (row: WorkflowSummary) => Promise<void>
  /** Non-null when leaving the editor's current contents would lose something unsaved: 'draft'
   *  for an unsaved agent-drafted workflow (US6), 'changes' for dirty edits to an ordinary saved
   *  workflow. Actions that would replace the editor's contents confirm discarding first. */
  unsavedGuard: 'draft' | 'changes' | null
  onDraft: (objective: string) => Promise<WorkflowDraftResult>
  onOpenDraft: (definition: Workflow) => void
}

function rowKey(row: Pick<WorkflowSummary, 'name' | 'source'>): string {
  return `${row.source}\u0000${row.name}`
}

/** FR-001: list, open, create, duplicate and delete workflows scoped to the active project. */
export default function WorkflowListPane({
  rows,
  loading,
  error,
  selected,
  onOpen,
  onCreate,
  onDuplicate,
  onDelete,
  unsavedGuard,
  onDraft,
  onOpenDraft
}: WorkflowListPaneProps): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false)
  const [duplicateTarget, setDuplicateTarget] = useState<WorkflowSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkflowSummary | null>(null)
  const [draftDialogOpen, setDraftDialogOpen] = useState(false)
  // Why: WorkflowNameDialog reads its initial name/source once, at mount — bumping these on every
  // open forces a fresh mount (a real `key` change) instead of a no-op effect that would flash the
  // previous value. Not bumped on close, so the closing dialog keeps its exit animation.
  const [createDialogGeneration, setCreateDialogGeneration] = useState(0)
  const [duplicateDialogGeneration, setDuplicateDialogGeneration] = useState(0)
  const [draftDialogGeneration, setDraftDialogGeneration] = useState(0)
  // Holds the action an entry point wanted to take (open a row, open Create, open Draft) until the
  // discard prompt is answered; null means no prompt is pending.
  const [pendingDiscardAction, setPendingDiscardAction] = useState<(() => void) | null>(null)

  const openCreateDialog = (): void => {
    setCreateDialogGeneration((generation) => generation + 1)
    setCreateOpen(true)
  }
  const openDuplicateDialog = (row: WorkflowSummary): void => {
    setDuplicateDialogGeneration((generation) => generation + 1)
    setDuplicateTarget(row)
  }
  const openDraftDialog = (): void => {
    setDraftDialogGeneration((generation) => generation + 1)
    setDraftDialogOpen(true)
  }

  /** Runs `action` now, unless there's unsaved content open — then it waits on the discard prompt. */
  function guardUnsavedDiscard(action: () => void): void {
    if (unsavedGuard) {
      setPendingDiscardAction(() => action)
    } else {
      action()
    }
  }

  return (
    <section className="flex h-full min-h-0 w-64 shrink-0 flex-col border-r border-border">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold text-foreground">
          {translate('auto.components.workflows.WorkflowListPane.heading', 'Workflows')}
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => guardUnsavedDiscard(openDraftDialog)}
            aria-label={translate(
              'auto.components.workflows.WorkflowListPane.draft',
              'Draft from objective'
            )}
          >
            <Sparkles />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => guardUnsavedDiscard(openCreateDialog)}
            aria-label={translate('auto.components.workflows.WorkflowListPane.new', 'New workflow')}
          >
            <Plus />
          </Button>
        </div>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="p-3 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {!loading && !error && rows.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            {translate(
              'auto.components.workflows.WorkflowListPane.empty',
              'No workflows yet. Create one to get started.'
            )}
          </p>
        ) : null}
        <ul>
          {rows.map((row) => {
            const isCurrent = selected?.name === row.name && selected.source === row.source
            return (
              <li key={rowKey(row)}>
                <div
                  data-current={isCurrent || undefined}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-2 hover:bg-accent',
                    isCurrent && 'bg-accent'
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    onClick={() => guardUnsavedDiscard(() => onOpen(row))}
                  >
                    {!row.valid ? (
                      <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                      {row.name}
                    </span>
                    {row.source === 'personal' ? (
                      <Badge variant="outline" className="shrink-0">
                        {translate(
                          'auto.components.workflows.WorkflowListPane.personalBadge',
                          'Personal'
                        )}
                      </Badge>
                    ) : null}
                  </button>
                  <span className="shrink-0 opacity-0 group-hover:opacity-100 [&:has([data-state=open])]:opacity-100">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={translate(
                            'auto.components.workflows.WorkflowListPane.rowActions',
                            'Workflow actions'
                          )}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => guardUnsavedDiscard(() => openDuplicateDialog(row))}
                        >
                          {translate(
                            'auto.components.workflows.WorkflowListPane.duplicate',
                            'Duplicate'
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleteTarget(row)}
                        >
                          {translate('auto.components.workflows.WorkflowListPane.delete', 'Delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <WorkflowNameDialog
        key={`create-${createDialogGeneration}`}
        open={createOpen}
        title={translate('auto.components.workflows.WorkflowListPane.createTitle', 'New workflow')}
        submitLabel={translate('auto.components.workflows.WorkflowListPane.createSubmit', 'Create')}
        onOpenChange={setCreateOpen}
        onSubmit={onCreate}
      />
      <WorkflowNameDialog
        key={`duplicate-${duplicateDialogGeneration}`}
        open={duplicateTarget !== null}
        title={translate(
          'auto.components.workflows.WorkflowListPane.duplicateTitle',
          'Duplicate workflow'
        )}
        submitLabel={translate(
          'auto.components.workflows.WorkflowListPane.duplicateSubmit',
          'Duplicate'
        )}
        initialName={duplicateTarget ? `${duplicateTarget.name}-copy` : undefined}
        fixedSource={duplicateTarget?.source}
        onOpenChange={(open) => !open && setDuplicateTarget(null)}
        onSubmit={async (newName) => {
          if (duplicateTarget) {
            await onDuplicate(duplicateTarget, newName)
          }
        }}
      />
      <WorkflowDeleteDialog
        workflowName={deleteTarget?.name ?? null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await onDelete(deleteTarget)
            setDeleteTarget(null)
          }
        }}
      />
      <DraftWorkflowDialog
        key={`draft-${draftDialogGeneration}`}
        open={draftDialogOpen}
        onOpenChange={setDraftDialogOpen}
        onDraft={onDraft}
        onOpenDraft={onOpenDraft}
      />
      <DiscardDraftDialog
        open={pendingDiscardAction !== null}
        reason={unsavedGuard ?? 'draft'}
        onOpenChange={(open) => !open && setPendingDiscardAction(null)}
        onConfirm={() => {
          const action = pendingDiscardAction
          setPendingDiscardAction(null)
          action?.()
        }}
      />
    </section>
  )
}
