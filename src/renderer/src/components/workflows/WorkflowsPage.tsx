import React from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import NodeInspector from './editor/NodeInspector'
import ValidationProblemsPanel from './editor/ValidationProblemsPanel'
import FileConflictDialog from './editor/FileConflictDialog'
import WorkflowListPane from './WorkflowListPane'
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

  const openName = session.openRef?.name
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
        <h1 className="truncate text-base font-semibold leading-8">
          {openName ?? translate('auto.components.workflows.WorkflowsPage.title', 'Workflows')}
        </h1>
        {session.status === 'ready' ? (
          <Button
            type="button"
            size="sm"
            disabled={!session.editor.state.dirty || session.saving}
            onClick={() => void session.save()}
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
              <div className="shrink-0 border-b border-border px-3 py-2 md:px-5">
                <RunToolbar
                  runState={run.snapshot?.state}
                  runObjective={run.snapshot?.objective}
                  canRun={controller.canRun}
                  starting={run.starting}
                  stopping={run.stopping}
                  onRun={(objective) => void run.start(objective)}
                  onStop={() => void run.stop()}
                  onRelayout={() => session.editor.dispatch({ type: 'auto-layout' })}
                />
              </div>
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
    </main>
  )
}
