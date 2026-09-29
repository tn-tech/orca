import React, { useMemo, useRef, useState } from 'react'
import { LayoutGrid, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isFolderRepo } from '../../../../shared/repo-kind'
import AddNodeMenu from './editor/AddNodeMenu'
import NodeInspector from './editor/NodeInspector'
import UndoButton from './editor/UndoButton'
import type { WorkflowCanvasHandle } from './editor/WorkflowCanvas'
import ValidationProblemsPanel from './editor/ValidationProblemsPanel'
import { useWorkflowEditorKeyboardShortcuts } from './editor/workflow-editor-keyboard-shortcuts'
import WorkflowEditorProblemNotice from './editor/WorkflowEditorProblemNotice'
import { summarizeNodeProblems } from './editor/workflow-node-problem-summary'
import FileConflictDialog from './editor/FileConflictDialog'
import WrapInLoopButton from './editor/WrapInLoopButton'
import RunHistoryButton from './RunHistoryButton'
import RunUnsavedChangesDialog from './RunUnsavedChangesDialog'
import SaveWorkflowButton from './SaveWorkflowButton'
import TrustedSourcesDialog from './TrustedSourcesDialog'
import WorkflowEditorPlaceholder from './WorkflowEditorPlaceholder'
import WorkflowListPane from './WorkflowListPane'
import WorkflowNameDialog from './WorkflowNameDialog'
import { repoTrustHostKey } from './workflow-repo-trust-host'
import AttemptPanel from './run-view/AttemptPanel'
import BackToEditingButton from './run-view/BackToEditingButton'
import RunCanvasOverlay from './run-view/RunCanvasOverlay'
import RunControls from './run-view/RunControls'
import RunHistory from './run-view/RunHistory'
import RunPendingPrompts from './run-view/RunPendingPrompts'
import RunToolbar from './run-view/RunToolbar'
import { useWorkflowRunSaveGuard } from './use-workflow-run-save-guard'
import { useWorkflowsPageController } from './use-workflows-page-controller'

/** FR-001/FR-009/FR-011/FR-012: list/open/create/duplicate/delete/save a project-scoped
 *  workflow, edit it on the canvas, and see every validation problem before Run. */
export default function WorkflowsPage(): React.JSX.Element {
  const controller = useWorkflowsPageController()
  const { session, run } = controller
  const runtimeEnvironmentId = useAppStore(
    (s) => s.settings?.activeRuntimeEnvironmentId?.trim() || null
  )
  const openModal = useAppStore((s) => s.openModal)
  const canvasRef = useRef<WorkflowCanvasHandle>(null)
  const [trustedSourcesOpen, setTrustedSourcesOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
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
  const definition = session.editor.state.definition
  // F7: flags each node with problems inline on the canvas.
  const nodeProblems = useMemo(
    () => summarizeNodeProblems(controller.problems, definition),
    [controller.problems, definition]
  )
  // F8: Run must never silently run the on-disk file while the editor has unsaved edits.
  const runSaveGuard = useWorkflowRunSaveGuard({
    session,
    settings: controller.settings,
    repoId: controller.repoId,
    start: run.start
  })

  // F4: Delete/Backspace and Cmd/Ctrl+Z, scoped to whatever the canvas currently selects. Not
  // gated on a shown run — Delete and Undo follow the same rule as every other edit here (F4
  // review round 1, Minor #3): Add node, Wrap in Loop, connect, drag, edge conditions and roles
  // all stay editable while a run is shown, so Delete/Undo/Unwrap do too.
  useWorkflowEditorKeyboardShortcuts({
    enabled: session.status === 'ready',
    canDelete: Boolean(controller.selectedNodeId ?? controller.selectedEdgeId),
    canUndo: session.status === 'ready' && session.editor.canUndo,
    onDelete: controller.deleteSelection,
    onUndo: controller.undo
  })

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
          <SaveWorkflowButton
            dirty={session.editor.state.dirty}
            isDraft={session.isDraft}
            saving={session.saving}
            invalidFields={controller.hasInvalidFields}
            disallowedSources={controller.hasDisallowedSources}
            onClick={() => {
              if (session.isDraft) {
                setNamingDraftGeneration((generation) => generation + 1)
                setNamingDraft(true)
              } else {
                void session.save()
              }
            }}
          />
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
          disabledReason={controller.noActiveProjectReason}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {session.status !== 'ready' ? (
            <WorkflowEditorPlaceholder
              status={session.status}
              loadError={session.loadError}
              noActiveProjectReason={controller.noActiveProjectReason}
              onAddProject={() => openModal('add-repo')}
            />
          ) : (
            <>
              {/* Three groups that each wrap whole: editing tools, the run (objective, state and
                  controls), then History/Re-layout. */}
              <div className="@container flex flex-wrap shrink-0 items-center gap-2 border-b border-border px-3 py-2 md:px-5">
                <div className="flex items-center gap-2">
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
                  <UndoButton
                    canUndo={session.status === 'ready' && session.editor.canUndo}
                    onUndo={controller.undo}
                  />
                  {run.snapshot ? <BackToEditingButton onClick={controller.backToEditing} /> : null}
                </div>
                <RunToolbar
                  runState={run.snapshot?.state}
                  runObjective={run.snapshot?.objective}
                  canRun={controller.canRun && !runSaveGuard.busy}
                  disabledReason={runSaveGuard.busyReason ?? controller.runDisabledReason}
                  starting={run.starting}
                  onRun={runSaveGuard.requestRun}
                  runControls={
                    <RunControls
                      runState={run.snapshot?.state}
                      pausing={run.pausing}
                      resuming={run.resuming}
                      cancelling={run.stopping}
                      onPause={() => void run.pause()}
                      onResume={() => void run.resume()}
                      onCancel={() => void run.stop()}
                    />
                  }
                />
                <div className="flex items-center gap-2">
                  <RunHistoryButton
                    reason={
                      !controller.repoId
                        ? controller.noActiveProjectReason
                        : !session.openRef
                          ? translate(
                              'auto.components.workflows.WorkflowsPage.historyBlocked',
                              'Save the workflow first.'
                            )
                          : undefined
                    }
                    onClick={() => setHistoryOpen(true)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      session.editor.dispatch({
                        type: 'auto-layout',
                        measuredSizes: canvasRef.current?.getMeasuredSizes()
                      })
                    }
                  >
                    <LayoutGrid />
                    {translate('auto.components.workflows.WorkflowsPage.relayout', 'Re-layout')}
                  </Button>
                </div>
              </div>
              <WorkflowEditorProblemNotice
                problem={session.editor.state.lastProblem}
                onWrapInLoop={(nodeIds) =>
                  session.editor.dispatch({ type: 'wrap-in-loop', nodeIds })
                }
                onDismiss={() => session.editor.dispatch({ type: 'dismiss-problem' })}
              />
              {run.snapshot ? (
                <RunPendingPrompts
                  snapshot={run.snapshot}
                  settings={controller.settings}
                  selectedNodeId={showAttemptPanel ? controller.selectedNodeId : undefined}
                  onSelectNode={controller.selectNode}
                />
              ) : null}
              <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1">
                  <RunCanvasOverlay
                    ref={canvasRef}
                    definition={session.editor.state.definition}
                    snapshot={run.snapshot}
                    nodeProblems={nodeProblems}
                    selectedNodeId={controller.selectedNodeId}
                    selectedEdgeId={controller.selectedEdgeId}
                    onNodeSelect={controller.selectNode}
                    onEdgeSelect={(edgeId) => {
                      controller.setSelectedEdgeId(edgeId)
                      if (edgeId) {
                        controller.setSelectedNodeId(undefined)
                      }
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
                      problems={controller.problems}
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
                      onWorkflowSettingsChange={(patch) =>
                        session.editor.dispatch({ type: 'update-settings', patch })
                      }
                      isFolderWorkspace={
                        controller.activeRepo ? isFolderRepo(controller.activeRepo) : false
                      }
                      onDeleteNode={controller.deleteNode}
                      onDeleteEdge={controller.deleteEdge}
                      onUnwrapLoop={controller.unwrapLoop}
                      onEditLoop={controller.editLoop}
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
              <div className="shrink-0 border-t border-border">
                <ValidationProblemsPanel
                  problems={controller.problems}
                  definition={session.editor.state.definition}
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
      <RunUnsavedChangesDialog
        open={runSaveGuard.confirmOpen}
        onSaveAndRun={runSaveGuard.confirmSaveAndRun}
        onCancel={runSaveGuard.cancelSaveAndRun}
      />
      <TrustedSourcesDialog
        open={trustedSourcesOpen}
        settings={controller.settings}
        onOpenChange={setTrustedSourcesOpen}
      />
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {translate('auto.components.workflows.WorkflowsPage.runHistoryTitle', 'Run history')}
            </DialogTitle>
          </DialogHeader>
          {session.openRef && controller.repoId ? (
            <RunHistory
              settings={controller.settings}
              repoId={controller.repoId}
              name={session.openRef.name}
              source={session.openRef.source}
              currentRunId={run.runId}
              onOpenRun={(runId) => {
                run.openRun(runId)
                setHistoryOpen(false)
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
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
