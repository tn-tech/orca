import React, { useId } from 'react'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { LoopNode } from '../../../../../shared/workflows/workflow-definition-types'
import ConditionBuilder from './ConditionBuilder'
import { InspectorField } from './InspectorField'

export type LoopNodeFieldsProps = {
  node: LoopNode
  onChange: (node: LoopNode) => void
}

/** Parses the maxIterations input; blank or non-positive text becomes `0`, the editor's "unset"
 *  sentinel (`checkLoopNodes` in workflow-graph-structural-rules.ts blocks save on it, US2 AS4). */
function parseMaxIterations(text: string): number {
  const parsed = Number.parseInt(text, 10)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 0
}

/** Loop node settings (FR-006): a required maximum iteration count and an exit condition over
 *  the exit node's result, edited with the same `ConditionBuilder` an edge condition uses. Entry,
 *  exit and body membership live in `LoopMembershipFields`. */
export default function LoopNodeFields({ node, onChange }: LoopNodeFieldsProps): React.JSX.Element {
  const maxIterationsId = useId()
  const missingCap = node.maxIterations < 1

  return (
    <>
      <InspectorField
        htmlFor={maxIterationsId}
        label={translate(
          'auto.components.workflows.editor.LoopNodeFields.maxIterationsLabel',
          'Maximum iterations'
        )}
      >
        <Input
          id={maxIterationsId}
          type="number"
          min={1}
          step={1}
          value={node.maxIterations > 0 ? node.maxIterations : ''}
          onChange={(event) =>
            onChange({ ...node, maxIterations: parseMaxIterations(event.target.value) })
          }
          aria-invalid={missingCap}
          className="h-8 w-24"
        />
        {missingCap ? (
          <p className="text-xs text-destructive">
            {translate(
              'auto.components.workflows.editor.LoopNodeFields.maxIterationsRequired',
              'Every loop needs a maximum iteration count before it can be saved.'
            )}
          </p>
        ) : null}
      </InspectorField>

      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.workflows.editor.LoopNodeFields.onCapReached',
          'When the cap is reached without exiting, the loop fails and the run stops.'
        )}
      </p>

      <InspectorField
        label={translate(
          'auto.components.workflows.editor.LoopNodeFields.exitConditionLabel',
          'Exit condition'
        )}
      >
        <ConditionBuilder
          condition={node.exitCondition}
          onChange={(condition) => {
            // exitCondition is required (data-model.md §1): an edit that clears every row would
            // hand back `undefined`, which we can't store, so it's dropped and ConditionBuilder
            // resyncs back to the last valid condition on its next render.
            if (condition) {
              onChange({ ...node, exitCondition: condition })
            }
          }}
        />
      </InspectorField>
    </>
  )
}
