import React from 'react'
import { X } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { LoopNode, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import DisabledReasonButton from '../DisabledReasonButton'
import { InspectorField } from './InspectorField'
import { loopMemberCandidates, type LoopEdit } from './workflow-loop-membership-commands'
import { workflowNodeName } from './workflow-problem-labels'

export type LoopMembershipFieldsProps = {
  node: LoopNode
  definition: Workflow
  onEditLoop: (edit: LoopEdit) => void
}

function MemberSelect({
  label,
  value,
  memberIds,
  definition,
  onChange
}: {
  label: string
  value: string
  memberIds: readonly string[]
  definition: Workflow
  onChange: (nodeId: string) => void
}): React.JSX.Element {
  return (
    <InspectorField label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {memberIds.map((id) => (
            <SelectItem key={id} value={id}>
              {workflowNodeName(definition, id)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </InspectorField>
  )
}

/** F11: a Loop's entry, exit and body members (data-model.md §1 LoopNode). */
export default function LoopMembershipFields({
  node,
  definition,
  onEditLoop
}: LoopMembershipFieldsProps): React.JSX.Element {
  const members = node.body.nodeIds
  const candidates = loopMemberCandidates(definition, node.id)
  const addLabel = translate(
    'auto.components.workflows.editor.LoopMembershipFields.addLabel',
    'Add a node to this Loop'
  )

  return (
    <>
      <MemberSelect
        label={translate(
          'auto.components.workflows.editor.LoopMembershipFields.entryLabel',
          'Entry node'
        )}
        value={node.entryNodeId}
        memberIds={members}
        definition={definition}
        onChange={(nodeId) => onEditLoop({ kind: 'set-entry', nodeId })}
      />
      <MemberSelect
        label={translate(
          'auto.components.workflows.editor.LoopMembershipFields.exitLabel',
          'Exit node'
        )}
        value={node.exitNodeId}
        memberIds={members}
        definition={definition}
        onChange={(nodeId) => onEditLoop({ kind: 'set-exit', nodeId })}
      />

      <InspectorField
        label={translate(
          'auto.components.workflows.editor.LoopMembershipFields.membersLabel',
          'Nodes in this Loop'
        )}
      >
        <ul className="flex flex-col gap-1">
          {members.map((id) => {
            const name = workflowNodeName(definition, id)
            const isEndpoint = id === node.entryNodeId || id === node.exitNodeId
            return (
              <li key={id} className="flex min-w-0 items-center justify-between gap-2 text-sm">
                <span className="truncate">{name}</span>
                <DisabledReasonButton
                  variant="ghost"
                  size="icon-xs"
                  reason={
                    isEndpoint
                      ? translate(
                          'auto.components.workflows.editor.LoopMembershipFields.endpointLocked',
                          'Choose a different entry or exit node before removing this one.'
                        )
                      : undefined
                  }
                  onClick={() => onEditLoop({ kind: 'remove-member', nodeId: id })}
                >
                  <X />
                  <span className="sr-only">
                    {translate(
                      'auto.components.workflows.editor.LoopMembershipFields.removeMember',
                      'Remove {{name}} from the Loop',
                      { name }
                    )}
                  </span>
                </DisabledReasonButton>
              </li>
            )
          })}
        </ul>
        {candidates.length > 0 ? (
          <Select value="" onValueChange={(nodeId) => onEditLoop({ kind: 'add-member', nodeId })}>
            <SelectTrigger className="h-8 w-full" aria-label={addLabel}>
              <SelectValue placeholder={addLabel} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {workflowNodeName(definition, candidate.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.workflows.editor.LoopMembershipFields.noCandidates',
              'Add an Agent, Reflection, Router, Join or Approval node outside any Loop to move it in here.'
            )}
          </p>
        )}
      </InspectorField>
    </>
  )
}
