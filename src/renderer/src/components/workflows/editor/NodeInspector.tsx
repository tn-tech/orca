import React, { useId } from 'react'
import { Trash2, Ungroup } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'
import type {
  Condition,
  Edge,
  Node,
  Role,
  Workflow,
  WorkflowProblem
} from '../../../../../shared/workflows/workflow-definition-types'
import RolesPanel, { type RoleEditorWorkflowContext } from '../roles/RolesPanel'
import AgentNodeFields from './AgentNodeFields'
import ApprovalNodeFields from './ApprovalNodeFields'
import ConditionBuilder from './ConditionBuilder'
import { InspectorField } from './InspectorField'
import InspectorProblemList from './InspectorProblemList'
import JoinNodeFields from './JoinNodeFields'
import LoopNodeFields from './LoopNodeFields'
import ReflectionNodeFields from './ReflectionNodeFields'
import RouterNodeFields from './RouterNodeFields'

export type NodeInspectorProps = {
  definition: Workflow
  selectedNodeId?: string
  selectedEdgeId?: string
  /** F7: every validation problem; the inspector shows the selected element's own. */
  problems?: readonly WorkflowProblem[]
  onNodeChange: (node: Node) => void
  onEdgeConditionChange: (edgeId: string, condition: Condition | undefined) => void
  /** US4 AS1: the workflow-level roles list, shown by `RolesPanel` when nothing is selected. */
  onSetRole: (roleId: string, role: Role) => void
  onRemoveRole: (roleId: string) => void
  /** F4: deleting a Loop node also removes its body (`deleteElementsFromDefinition`'s cascade) —
   *  this button doesn't need a Loop-specific variant to do that. */
  onDeleteNode?: (nodeId: string) => void
  onDeleteEdge?: (edgeId: string) => void
  /** F4: removes the Loop node, keeps its body, re-links entry/exit edges. */
  onUnwrapLoop?: (nodeId: string) => void
  allowlistedSources?: readonly string[]
  repo?: string
  /** The open repo's trust host (FR-018a); forwarded to `RolesPanel` -> `RoleEditor`. */
  host?: string
  settings?: RuntimeWorkflowSettings
  workflow?: RoleEditorWorkflowContext
  onReloadFromDisk?: () => void | Promise<void>
}

const NO_PROBLEMS: readonly WorkflowProblem[] = []

function nodeTypeLabel(type: Node['type']): string {
  switch (type) {
    case 'start':
      return translate('auto.components.workflows.editor.NodeInspector.typeStart', 'Start')
    case 'end':
      return translate('auto.components.workflows.editor.NodeInspector.typeEnd', 'End')
    case 'agent':
      return translate('auto.components.workflows.editor.NodeInspector.typeAgent', 'Agent')
    case 'router':
      return translate('auto.components.workflows.editor.NodeInspector.typeRouter', 'Router')
    case 'loop':
      return translate('auto.components.workflows.editor.NodeInspector.typeLoop', 'Loop')
    case 'join':
      return translate('auto.components.workflows.editor.NodeInspector.typeJoin', 'Join')
    case 'approval':
      return translate('auto.components.workflows.editor.NodeInspector.typeApproval', 'Approval')
    case 'reflection':
      return translate(
        'auto.components.workflows.editor.NodeInspector.typeReflection',
        'Reflection'
      )
  }
}

function NodeBaseFields({
  node,
  onChange
}: {
  node: Node
  onChange: (node: Node) => void
}): React.JSX.Element {
  const titleId = useId()
  const notesId = useId()
  return (
    <>
      <InspectorField
        htmlFor={titleId}
        label={translate('auto.components.workflows.editor.NodeInspector.titleLabel', 'Title')}
      >
        <Input
          id={titleId}
          value={node.title}
          aria-invalid={node.title === ''}
          onChange={(event) => onChange({ ...node, title: event.target.value })}
          className="h-8"
        />
      </InspectorField>
      <InspectorField
        htmlFor={notesId}
        label={translate('auto.components.workflows.editor.NodeInspector.notesLabel', 'Notes')}
      >
        <Textarea
          id={notesId}
          value={node.notes ?? ''}
          onChange={(event) => onChange({ ...node, notes: event.target.value || undefined })}
          className="min-h-16"
        />
      </InspectorField>
    </>
  )
}

function findEdge(definition: Workflow, edgeId: string): Edge | undefined {
  return definition.edges.find((edge) => edge.id === edgeId)
}

function countIncomingEdges(definition: Workflow, nodeId: string): number {
  return definition.edges.filter((edge) => edge.to === nodeId).length
}

/** Edge conditions (FR-008) editable via `ConditionBuilder`; Agent node settings (FR-003/FR-004)
 *  via `AgentNodeFields`; the workflow's roles (US4 AS1) via `RolesPanel` when nothing is
 *  selected. Other node types get title/notes only until their own units land. */
export default function NodeInspector({
  definition,
  selectedNodeId,
  selectedEdgeId,
  problems = NO_PROBLEMS,
  onNodeChange,
  onEdgeConditionChange,
  onSetRole,
  onRemoveRole,
  onDeleteNode,
  onDeleteEdge,
  onUnwrapLoop,
  allowlistedSources,
  repo,
  host,
  settings,
  workflow,
  onReloadFromDisk
}: NodeInspectorProps): React.JSX.Element {
  const edge = selectedEdgeId ? findEdge(definition, selectedEdgeId) : undefined
  const node = selectedNodeId ? definition.nodes.find((n) => n.id === selectedNodeId) : undefined

  if (edge) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto scrollbar-sleek p-4">
        <h2 className="text-sm font-semibold">
          {translate(
            'auto.components.workflows.editor.NodeInspector.edgeHeading',
            'Edge condition'
          )}
        </h2>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.editor.NodeInspector.edgeSubheading',
            '{{from}} → {{to}}',
            { from: edge.from, to: edge.to }
          )}
        </p>
        <InspectorProblemList
          problems={problems.filter((problem) => problem.edgeId === edge.id)}
          definition={definition}
        />
        <ConditionBuilder
          key={edge.id}
          condition={edge.condition}
          onChange={(condition) => onEdgeConditionChange(edge.id, condition)}
        />
        {onDeleteEdge ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onDeleteEdge(edge.id)}
            className="mt-auto"
          >
            <Trash2 />
            {translate('auto.components.workflows.editor.NodeInspector.deleteEdge', 'Delete edge')}
          </Button>
        ) : null}
      </div>
    )
  }

  if (!node) {
    return (
      <RolesPanel
        roles={definition.roles}
        onSetRole={onSetRole}
        onRemoveRole={onRemoveRole}
        allowlistedSources={allowlistedSources}
        repo={repo}
        host={host}
        settings={settings}
        workflow={workflow}
        onReloadFromDisk={onReloadFromDisk}
      />
    )
  }

  return (
    <div key={node.id} className="flex h-full flex-col gap-4 overflow-y-auto scrollbar-sleek p-4">
      <h2 className="text-sm font-semibold">{nodeTypeLabel(node.type)}</h2>
      <InspectorProblemList
        problems={problems.filter((problem) => problem.nodeId === node.id)}
        definition={definition}
      />
      <NodeBaseFields node={node} onChange={onNodeChange} />
      {node.type === 'agent' ? (
        <AgentNodeFields
          node={node}
          roles={definition.roles}
          onChange={onNodeChange}
          allowlistedSources={allowlistedSources}
        />
      ) : node.type === 'loop' ? (
        <LoopNodeFields node={node} onChange={onNodeChange} />
      ) : node.type === 'join' ? (
        <JoinNodeFields
          node={node}
          incomingEdgeCount={countIncomingEdges(definition, node.id)}
          onChange={onNodeChange}
        />
      ) : node.type === 'router' ? (
        <RouterNodeFields node={node} roles={definition.roles} onChange={onNodeChange} />
      ) : node.type === 'approval' ? (
        <ApprovalNodeFields node={node} onChange={onNodeChange} />
      ) : node.type === 'reflection' ? (
        <ReflectionNodeFields node={node} roles={definition.roles} onChange={onNodeChange} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.editor.NodeInspector.typeNotYetSupported',
            'Detailed settings for this node type land in a later unit.'
          )}
        </p>
      )}
      {onDeleteNode || (onUnwrapLoop && node.type === 'loop') ? (
        <div className="mt-auto flex flex-col gap-2">
          {onUnwrapLoop && node.type === 'loop' ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onUnwrapLoop(node.id)}>
              <Ungroup />
              {translate('auto.components.workflows.editor.NodeInspector.unwrapLoop', 'Unwrap')}
            </Button>
          ) : null}
          {onDeleteNode ? (
            // F4: Start is deletable like any other node — `graph_missing_start` already blocks
            // Save the same way a disconnected node does (audit-static.md §1), so there's no
            // separate "can't delete Start" state to build; validation catches it instead.
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => onDeleteNode(node.id)}
            >
              <Trash2 />
              {node.type === 'loop'
                ? translate(
                    'auto.components.workflows.editor.NodeInspector.deleteLoop',
                    'Delete Loop'
                  )
                : translate(
                    'auto.components.workflows.editor.NodeInspector.deleteNode',
                    'Delete node'
                  )}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
