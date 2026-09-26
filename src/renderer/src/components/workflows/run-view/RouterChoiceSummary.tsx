import React from 'react'
import { translate } from '@/i18n/i18n'
import type { JsonValue } from '../../../../../shared/workflows/workflow-definition-types'
import { InspectorField } from '../editor/InspectorField'

export type RouterChoice = { choice: string; reason: string }

/**
 * Reads a Router attempt's fixed result contract `{ choice: string; reason: string }`
 * (data-model.md §1 RouterNode, FR-029) out of `resultJson` without trusting its shape — the
 * engine unit lands this field concurrently with this one.
 */
export function readRouterChoice(resultJson: JsonValue | undefined): RouterChoice | undefined {
  if (typeof resultJson !== 'object' || resultJson === null || Array.isArray(resultJson)) {
    return undefined
  }
  const { choice, reason } = resultJson
  return typeof choice === 'string' && typeof reason === 'string' ? { choice, reason } : undefined
}

export type RouterChoiceSummaryProps = {
  result: RouterChoice
}

/** The recorded choice and reason for a settled Router attempt (US3 AS6, FR-029). */
export default function RouterChoiceSummary({
  result
}: RouterChoiceSummaryProps): React.JSX.Element {
  return (
    <>
      <InspectorField
        label={translate(
          'auto.components.workflows.run-view.RouterChoiceSummary.choiceLabel',
          'Choice'
        )}
      >
        <p className="text-sm text-foreground">{result.choice}</p>
      </InspectorField>
      <InspectorField
        label={translate(
          'auto.components.workflows.run-view.RouterChoiceSummary.reasonLabel',
          'Reason'
        )}
      >
        <p className="text-xs text-muted-foreground">{result.reason}</p>
      </InspectorField>
    </>
  )
}
