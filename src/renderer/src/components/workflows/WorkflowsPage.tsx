import React, { useMemo, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import AddNodeMenu from './editor/AddNodeMenu'
import NodeInspector from './editor/NodeInspector'
import ValidationProblemsPanel from './editor/ValidationProblemsPanel'
import WorkflowEditorProblemNotice from './editor/WorkflowEditorProblemNotice'
import { hasBlockingWorkflowProblems } from './editor/workflow-validation-merge'
import FileConflictDialog from './editor/FileConflictDialog'
import WrapInLoopButton from './editor/WrapInLoopButton'
import TrustedSourcesDialog from './TrustedSourcesDialog'
import WorkflowListPane from './WorkflowListPane'
import WorkflowNameDialog from './WorkflowNameDialog'
import { repoTrustHostKey } from './workflow-repo-trust-host'
import AttemptPanel from './run-view/AttemptPanel'
import RunCanvasOverlay from './run-view/RunCanvasOverlay'
import RunToolbar from './run-view/RunToolbar'
import { useWorkflowsPageController } from './use-workflows-page-controller'

/** FR-001/FR-009/FR-011/FR-012: list/open/create/duplicate/delete/save a project-scoped
 *  workflow, edit it on the canvas, and see every validation problem before Run. */
export default function WorkflowsPage(): React.JSX.Element {
  const controller = useWorkflowsPageController()
  const { session, run } = controller
  const runtimeEnvironmentId = useAppStore(
    (s) => s.settings?.activeRuntimeEnvironmentId?.trim() || null
  )
  const [trustedSourcesOpen, setTrustedSourcesOpen] = useState(false)
  // US6: names and writes an open draft on its first save; see WorkflowNameDialog generation
  // comment in WorkflowListPane.tsx for why this bumps on every open rather than resetting on close.
  const [namingDraft, setNamingDraft] = useState(false)
  const [namingDraftGeneration, setNamingDraftGeneration] = useState(0)
  // FR-018a: the editor's Trust dialog (RoleEditor, before any run exists) must land its decision
  // on the repo's own host, not always `local`.
  const repoTrustHost = useMemo(
    () => repoTrustHostKey(controller.activeRepo),
    [controller.activeRepo]
  )

  const openName = session.openRef?.name
  const draftName = session.isDraft ? session.editor.state.definition.name : undefined
  // Guards WorkflowListPane's entry points against silently discarding either kind of unsaved
  // content: an agent-drafted workflow never written to disk, or dirty edits to a saved one.
  const unsavedGuard: 'draft' | 'changes' | null = session.isDraft
    ? 'draft'
    : session.status === 'ready' && session.editor.state.dirty
      ? 'changes'
      : null
  const headerTitle =
    openName ??
    draftName ??
    (session.isDraft
      ? translate('auto.components.workflows.WorkflowsPage.untitledDraft', 'Untitled draft')
      : translate('auto.components.workflows.WorkflowsPage.title', 'Workflows'))
  // While a run exists, a selected node shows its attempt instead of its editable settings
  // (FR-036); edge conditions still go through NodeInspector regardless.
  const showAttemptPanel =
    run.snapshot !== null && Boolean(controller.selectedNodeId) && !controller.selectedEdgeId

  return (
    <main className="relative flex h-full min-h-0 flex-col bg-background pt-5 text-foreground md:pt-6">
      <header
        className="flex shrink-0 items-center justify-between gap-3 px-3 pb-3 md:px-5"
        style={{ paddingRight: 'max(0.75rem, var(--window-controls-width, 0px))' }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-base font-semibold leading-8">{headerTitle}</h1>
          {session.isDraft ? (
            <Badge variant="outline" className="shrink-0">
              {translate('auto.components.workflows.WorkflowsPage.draftBadge', 'Draft')}
            </Badge>
          ) : null}
        </div>
        {controller.settings?.experimentalWorkflows === true ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setTrustedSourcesOpen(true)}
          >
            <ShieldCheck />
            {translate('auto.components.workflows.WorkflowsPage.trustedSources', 'Trusted sources')}
          </Button>
        ) : null}
        {session.status === 'ready' ? (
          <Button
            type="button"
            size="sm"
            disabled={
              (!session.editor.state.dirty && !session.isDraft) ||
              session.saving ||
              hasBlockingWorkflowProblems(controller.problems)
            }
            title={
              hasBlockingWorkflowProblems(controller.problems)
                ? translate(
                    'auto.components.workflows.WorkflowsPage.saveBlocked',
                    'Fix the problems below before saving.'
                  )
                : undefined
            }
            onClick={() => {
              if (session.isDraft) {
                setNamingDraftGeneration((generation) => generation + 1)
                setNamingDraft(true)
              } else {
                void session.save()
              }
            }}
          >
            {session.saving ? <Loader2 className="animate-spin" /> : null}
            {translate('auto.components.workflows.WorkflowsPage.save', 'Save')}
          </Button>
        ) : null}
      </header>
      <div className="flex flex-1 min-h-0">
        <WorkflowListPane
          rows={controller.list.rows}
          loading={controller.list.loading}
          error={controller.list.error}
          selected={session.openRef}
          onOpen={controller.openWorkflow}
          onCreate={controller.createWorkflow}
          onDuplicate={controller.duplicateWorkflow}
          onDelete={controller.deleteWorkflow}
          unsavedGuard={unsavedGuard}
          onDraft={controller.draftWorkflow}
          onOpenDraft={controller.openDraft}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          {session.status === 'empty' ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {translate(
                'auto.components.workflows.WorkflowsPage.placeholder',
                'Select a workflow, or create a new one.'
              )}
            </div>
          ) : session.status === 'loading' ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              {translate('auto.components.workflows.WorkflowsPage.loading', 'Loading…')}
            </div>
          ) : session.status === 'error' ? (
            <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-destructive">
              {session.loadError}
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 md:px-5">
                <AddNodeMenu
                  hasStartNode={session.editor.state.definition.nodes.some(
                    (node) => node.type === 'start'
                  )}
                  onAddNode={controller.addNode}
                />
                <WrapInLoopButton
                  selectedNodeIds={controller.selectedNodeId ? [controller.selectedNodeId] : []}
                  onWrapInLoop={(nodeIds) =>
                    session.editor.dispatch({ type: 'wrap-in-loop', nodeIds })
                  }
                />
                <div className="min-w-0 flex-1">
                  <RunToolbar
                    runState={run.snapshot?.state}
                    runObjective={run.snapshot?.objective}
                    canRun={controller.canRun}
                    disabledReason={
                      session.isDraft
                        ? translate(
                            'auto.components.workflows.WorkflowsPage.runBlockedDraft',
                            'Save this draft before running it.'
                          )
                        : undefined
                    }
                    starting={run.starting}
                    stopping={run.stopping}
                    onRun={(objective) => void run.start(objective)}
                    onStop={() => void run.stop()}
                    onRelayout={() => session.editor.dispatch({ type: 'auto-layout' })}
                  />
                </div>
              </div>
              <WorkflowEditorProblemNotice
                problem={session.editor.state.lastProblem}
                onWrapInLoop={(nodeIds) =>
                  session.editor.dispatch({ type: 'wrap-in-loop', nodeIds })
                }
                onDismiss={() => session.editor.dispatch({ type: 'dismiss-problem' })}
              />
              <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1">
                  <RunCanvasOverlay
                    definition={session.editor.state.definition}
                    snapshot={run.snapshot}
                    selectedNodeId={controller.selectedNodeId}
                    selectedEdgeId={controller.selectedEdgeId}
                    onNodeSelect={(nodeId) => {
                      controller.setSelectedNodeId(nodeId)
                      controller.setSelectedEdgeId(undefined)
                    }}
                    onEdgeSelect={(edgeId) => {
                      controller.setSelectedEdgeId(edgeId)
                      controller.setSelectedNodeId(undefined)
                    }}
                    onNodeDragStop={(nodeId, position) =>
                      session.editor.dispatch({ type: 'move-node', nodeId, position })
                    }
                    onConnect={(connection) =>
                      session.editor.dispatch({ type: 'connect', ...connection })
                    }
                  />
                </div>
                <div className="w-80 shrink-0 border-l border-border">
                  {showAttemptPanel && controller.selectedNodeId && run.snapshot ? (
                    <AttemptPanel
                      definition={session.editor.state.definition}
                      snapshot={run.snapshot}
                      nodeId={controller.selectedNodeId}
                      runtimeEnvironmentId={runtimeEnvironmentId}
                      settings={controller.settings}
                      onWorkflowFileChanged={() => void session.checkForExternalChange()}
                      // Review round 1 (Important): not `session.reloadFromDisk` — that discards
                      // unsaved edits unconditionally. `checkForExternalChange` re-reads the file
                      // and only adopts it silently when the editor is clean, raising the existing
                      // conflict dialog instead of clobbering a dirty draft.
                      onReloadFromDisk={() => void session.checkForExternalChange()}
                    />
                  ) : (
                    <NodeInspector
                      definition={session.editor.state.definition}
                      selectedNodeId={controller.selectedNodeId}
                      selectedEdgeId={controller.selectedEdgeId}
                      onNodeChange={(node) =>
                        session.editor.dispatch({ type: 'update-node', node })
                      }
                      onEdgeConditionChange={(edgeId, condition) =>
                        session.editor.dispatch({
                          type: 'update-edge-condition',
                          edgeId,
                          condition
                        })
                      }
                      onSetRole={(roleId, role) =>
                        session.editor.dispatch({ type: 'set-role', roleId, role })
                      }
                      onRemoveRole={(roleId) =>
                        session.editor.dispatch({ type: 'remove-role', roleId })
                      }
                      allowlistedSources={controller.allowlistedSources}
                      repo={controller.repoId}
                      host={repoTrustHost}
                      settings={controller.settings}
                      workflow={
                        session.openRef
                          ? {
                              name: session.openRef.name,
                              source: session.openRef.source,
                              revision: session.documentRevision,
                              dirty: session.editor.state.dirty
                            }
                          : undefined
                      }
                      onReloadFromDisk={session.reloadFromDisk}
                    />
                  )}
                </div>
              </div>
              <div className="h-48 shrink-0 border-t border-border">
                <ValidationProblemsPanel
                  problems={controller.problems}
                  onFocusProblem={controller.focusProblem}
                />
              </div>
            </>
          )}
        </div>
      </div>
      <FileConflictDialog
        open={session.conflict !== null}
        workflowName={openName ?? ''}
        reason={session.conflict ?? 'external'}
        onReload={() => void session.reloadFromDisk()}
        onOverwrite={() => void session.overwriteOnDisk()}
        onCancel={session.dismissConflict}
      />
      <TrustedSourcesDialog
        open={trustedSourcesOpen}
        settings={controller.settings}
        onOpenChange={setTrustedSourcesOpen}
      />
      <WorkflowNameDialog
        key={`save-draft-${namingDraftGeneration}`}
        open={namingDraft}
        title={translate('auto.components.workflows.WorkflowsPage.saveDraftTitle', 'Save draft')}
        submitLabel={translate('auto.components.workflows.WorkflowsPage.saveDraftSubmit', 'Save')}
        initialName={draftName || undefined}
        onOpenChange={setNamingDraft}
        onSubmit={(name, source) => controller.saveDraft(name, source)}
      />
    </main>
  )
}
