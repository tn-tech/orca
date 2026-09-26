import React, { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type {
  Condition,
  Edge,
  Node,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import AgentNodeFields from './AgentNodeFields'
import ConditionBuilder from './ConditionBuilder'
import { InspectorField } from './InspectorField'
import JoinNodeFields from './JoinNodeFields'
import LoopNodeFields from './LoopNodeFields'
import RouterNodeFields from './RouterNodeFields'

export type NodeInspectorProps = {
  definition: Workflow
  selectedNodeId?: string
  selectedEdgeId?: string
  onNodeChange: (node: Node) => void
  onEdgeConditionChange: (edgeId: string, condition: Condition | undefined) => void
}

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
 *  via `AgentNodeFields`. Other node types get title/notes only until their own units land. */
export default function NodeInspector({
  definition,
  selectedNodeId,
  selectedEdgeId,
  onNodeChange,
  onEdgeConditionChange
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
        <ConditionBuilder
          key={edge.id}
          condition={edge.condition}
          onChange={(condition) => onEdgeConditionChange(edge.id, condition)}
        />
      </div>
    )
  }

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        {translate(
          'auto.components.workflows.editor.NodeInspector.emptyState',
          'Select a node or edge to edit its settings.'
        )}
      </div>
    )
  }

  return (
    <div key={node.id} className="flex h-full flex-col gap-4 overflow-y-auto scrollbar-sleek p-4">
      <h2 className="text-sm font-semibold">{nodeTypeLabel(node.type)}</h2>
      <NodeBaseFields node={node} onChange={onNodeChange} />
      {node.type === 'agent' ? (
        <AgentNodeFields node={node} roles={definition.roles} onChange={onNodeChange} />
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
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.editor.NodeInspector.typeNotYetSupported',
            'Detailed settings for this node type land in a later unit.'
          )}
        </p>
      )}
    </div>
  )
}
