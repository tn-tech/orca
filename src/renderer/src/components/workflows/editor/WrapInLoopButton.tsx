import React from 'react'
import { Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export type WrapInLoopButtonProps = {
  /** The current selection. The editor has no multi-select UI yet, so this is always 0 or 1 node
   *  ids today — kept as an array since `wrap-in-loop` (`use-workflow-editor-state.ts`) already
   *  accepts a general selection and a future multi-select shouldn't need a prop shape change. */
  selectedNodeIds: readonly string[]
  onWrapInLoop: (nodeIds: string[]) => void
}

/**
 * U63 fix round 1: before this, the only way to create a Loop node was drawing a doomed back-edge
 * and clicking the resulting refusal's "Wrap in Loop" button (`WorkflowEditorProblemNotice.tsx`).
 * This dispatches the same `wrap-in-loop` action directly for whatever's currently selected.
 * `wrapNodesInLoopInDefinition` already refuses (surfaced through the same notice) a selection it
 * can't wrap — wrong node type, disconnected, or more than one entry/exit — so this button doesn't
 * duplicate any of that validation, it just makes the action reachable without a cycle first.
 */
export default function WrapInLoopButton({
  selectedNodeIds,
  onWrapInLoop
}: WrapInLoopButtonProps): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={selectedNodeIds.length === 0}
      onClick={() => onWrapInLoop([...selectedNodeIds])}
    >
      <Repeat />
      {translate('auto.components.workflows.editor.WrapInLoopButton.trigger', 'Wrap in Loop')}
    </Button>
  )
}
