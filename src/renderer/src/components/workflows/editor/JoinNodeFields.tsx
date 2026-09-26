import React, { useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { JoinNode } from '../../../../../shared/workflows/workflow-definition-types'
import { InspectorField } from './InspectorField'

export type JoinNodeFieldsProps = {
  node: JoinNode
  /** Edges into this node, so the quorum count can be flagged against how many branches exist. */
  incomingEdgeCount: number
  onChange: (node: JoinNode) => void
}

type JoinPolicyKind = 'all' | 'any' | 'quorum'

function policyKind(policy: JoinNode['policy']): JoinPolicyKind {
  return policy === 'all' || policy === 'any' ? policy : 'quorum'
}

function quorumCount(policy: JoinNode['policy']): number {
  return typeof policy === 'object' ? policy.quorum : 1
}

/** `undefined` for anything that isn't a plain positive integer (blank, `-1`, `1.5`, `12abc`, …) —
 *  the caller keeps the user's draft text on screen and simply doesn't commit until this parses. */
function parseValidQuorum(text: string): number | undefined {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) {
    return undefined
  }
  const parsed = Number.parseInt(trimmed, 10)
  return parsed >= 1 ? parsed : undefined
}

/** Join node settings (FR-007, data-model.md §1 JoinNode): wait-all/wait-any/quorum(n) plus a
 *  fail/skip/partial failure policy. Incoming branches are wired by connecting edges on the
 *  canvas, same as any other node — this panel only edits the two policy fields. */
export default function JoinNodeFields({
  node,
  incomingEdgeCount,
  onChange
}: JoinNodeFieldsProps): React.JSX.Element {
  const kind = policyKind(node.policy)
  const quorum = quorumCount(node.policy)
  const quorumExceedsBranches =
    kind === 'quorum' && incomingEdgeCount > 0 && quorum > incomingEdgeCount

  // `quorumDraft` is the free-typed text; it only snaps to the committed value when that value
  // changes for a reason other than our own commit below — switching nodes, switching policy
  // kind, undo/redo (mirrors ConditionBuilder's resync pattern). It never snaps back while the
  // user is mid-edit with unparseable text: coercing an emptied field straight back to `1` fought
  // typing a replacement value (review round 1).
  const [quorumDraft, setQuorumDraft] = useState(() => String(quorum))
  const [syncedQuorum, setSyncedQuorum] = useState(quorum)
  if (quorum !== syncedQuorum) {
    setSyncedQuorum(quorum)
    setQuorumDraft(String(quorum))
  }
  const quorumParsed = parseValidQuorum(quorumDraft)

  function handleQuorumInput(text: string): void {
    setQuorumDraft(text)
    const parsed = parseValidQuorum(text)
    if (parsed !== undefined) {
      onChange({ ...node, policy: { quorum: parsed } })
    }
  }

  function setPolicyKind(next: string): void {
    if (next === 'all' || next === 'any') {
      onChange({ ...node, policy: next })
    } else if (next === 'quorum') {
      onChange({ ...node, policy: { quorum } })
    }
  }

  function setOnFailure(next: string): void {
    if (next === 'fail' || next === 'skip' || next === 'partial') {
      onChange({ ...node, onFailure: next })
    }
  }

  return (
    <>
      <InspectorField
        label={translate('auto.components.workflows.editor.JoinNodeFields.policyLabel', 'Policy')}
      >
        <Select value={kind} onValueChange={setPolicyKind}>
          <SelectTrigger
            className="h-8 w-full"
            aria-label={translate(
              'auto.components.workflows.editor.JoinNodeFields.policyLabel',
              'Policy'
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {translate(
                'auto.components.workflows.editor.JoinNodeFields.policyAll',
                'Wait for all branches'
              )}
            </SelectItem>
            <SelectItem value="any">
              {translate(
                'auto.components.workflows.editor.JoinNodeFields.policyAny',
                'Continue on the first branch'
              )}
            </SelectItem>
            <SelectItem value="quorum">
              {translate(
                'auto.components.workflows.editor.JoinNodeFields.policyQuorum',
                'Continue after a quorum'
              )}
            </SelectItem>
          </SelectContent>
        </Select>
        {kind === 'quorum' ? (
          <>
            <Input
              type="number"
              min={1}
              step={1}
              value={quorumDraft}
              onChange={(event) => handleQuorumInput(event.target.value)}
              aria-label={translate(
                'auto.components.workflows.editor.JoinNodeFields.quorumLabel',
                'Quorum'
              )}
              aria-invalid={quorumParsed === undefined || quorumExceedsBranches}
              className="mt-1.5 h-8 w-24"
            />
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.workflows.editor.JoinNodeFields.incomingBranches',
                '{{count}} incoming branch(es).',
                { count: incomingEdgeCount }
              )}
            </p>
            {quorumParsed === undefined ? (
              <p className="text-xs text-destructive">
                {translate(
                  'auto.components.workflows.editor.JoinNodeFields.quorumInvalid',
                  'Enter a whole number of 1 or more.'
                )}
              </p>
            ) : quorumExceedsBranches ? (
              <p className="text-xs text-destructive">
                {translate(
                  'auto.components.workflows.editor.JoinNodeFields.quorumExceedsBranches',
                  'Quorum is higher than the number of incoming branches.'
                )}
              </p>
            ) : null}
          </>
        ) : null}
      </InspectorField>

      <InspectorField
        label={translate(
          'auto.components.workflows.editor.JoinNodeFields.onFailureLabel',
          'When a branch fails'
        )}
      >
        <Select value={node.onFailure} onValueChange={setOnFailure}>
          <SelectTrigger
            className="h-8 w-full"
            aria-label={translate(
              'auto.components.workflows.editor.JoinNodeFields.onFailureLabel',
              'When a branch fails'
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fail">
              {translate(
                'auto.components.workflows.editor.JoinNodeFields.onFailureFail',
                'Fail the join'
              )}
            </SelectItem>
            <SelectItem value="skip">
              {translate(
                'auto.components.workflows.editor.JoinNodeFields.onFailureSkip',
                'Treat the branch as skipped'
              )}
            </SelectItem>
            <SelectItem value="partial">
              {translate(
                'auto.components.workflows.editor.JoinNodeFields.onFailurePartial',
                'Continue with partial results'
              )}
            </SelectItem>
          </SelectContent>
        </Select>
      </InspectorField>
    </>
  )
}
