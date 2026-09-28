import React from 'react'
import { Bot, Flag, GitMerge, Play, Plus, Sparkles, UserCheck, Waypoints } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import {
  ADDABLE_NODE_KINDS,
  addNodeMenuLabel,
  type AddableNodeKind
} from './workflow-new-node-defaults'

export type AddNodeMenuProps = {
  /** Excludes Start from the menu once one exists: `checkStartAndEnd` only allows one
   *  (graph_multiple_start_nodes). */
  hasStartNode: boolean
  onAddNode: (kind: AddableNodeKind) => void
}

/** Matches the icon each node type renders on the canvas (`nodes/*.tsx`). */
const KIND_ICONS: Record<AddableNodeKind, React.ComponentType<{ className?: string }>> = {
  start: Play,
  agent: Bot,
  router: Waypoints,
  join: GitMerge,
  approval: UserCheck,
  reflection: Sparkles,
  end: Flag
}

/**
 * Toolbar control (U63): the only way to create a node other than the "Wrap in Loop" offer on a
 * refused back-edge (`WorkflowEditorProblemNotice.tsx`). Lists every kind `WorkflowCanvas.tsx` can
 * render except Loop (see `workflow-new-node-defaults.ts` for why) and, once a Start node already
 * exists, Start itself.
 */
export default function AddNodeMenu({
  hasStartNode,
  onAddNode
}: AddNodeMenuProps): React.JSX.Element {
  const kinds = ADDABLE_NODE_KINDS.filter((kind) => kind !== 'start' || !hasStartNode)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus />
          {translate('auto.components.workflows.editor.AddNodeMenu.trigger', 'Add node')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {kinds.map((kind) => {
          const Icon = KIND_ICONS[kind]
          return (
            <DropdownMenuItem key={kind} onSelect={() => onAddNode(kind)}>
              <Icon className="text-muted-foreground" />
              {addNodeMenuLabel(kind)}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
