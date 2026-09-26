import React from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { JsonValue } from '../../../../../shared/workflows/workflow-definition-types'
import { InspectorField } from '../editor/InspectorField'

const KNOWN_OUTCOMES = new Set(['completed', 'failed', 'skipped', 'pending'])

/**
 * Reads `{ branches: Record<sourceNodeId, outcome> }` from a Join attempt's `resultJson`
 * (`workflow-join-policy.ts`'s `JoinBranches`, data-model.md §4 "Join"), without importing that
 * engine-only type — `src/main/runtime/` types aren't for the renderer to depend on, and the
 * engine unit lands this field concurrently with this one, so unrecognized shapes read as absent
 * rather than throwing.
 */
export function readJoinBranches(
  resultJson: JsonValue | undefined
): Record<string, string> | undefined {
  if (typeof resultJson !== 'object' || resultJson === null || Array.isArray(resultJson)) {
    return undefined
  }
  const branches = resultJson.branches
  if (typeof branches !== 'object' || branches === null || Array.isArray(branches)) {
    return undefined
  }
  const entries = Object.entries(branches).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && KNOWN_OUTCOMES.has(entry[1])
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function outcomeDotClassName(outcome: string): string {
  switch (outcome) {
    case 'completed':
      return 'bg-status-success'
    case 'failed':
      return 'bg-destructive'
    case 'skipped':
      return 'bg-muted-foreground'
    default:
      return 'bg-workspace-status-progress'
  }
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'completed':
      return translate(
        'auto.components.workflows.run-view.JoinBranchOutcomes.completed',
        'Completed'
      )
    case 'failed':
      return translate('auto.components.workflows.run-view.JoinBranchOutcomes.failed', 'Failed')
    case 'skipped':
      return translate('auto.components.workflows.run-view.JoinBranchOutcomes.skipped', 'Skipped')
    default:
      return translate('auto.components.workflows.run-view.JoinBranchOutcomes.pending', 'Pending')
  }
}

export type JoinBranchOutcomesProps = {
  branches: Record<string, string>
}

/** Per-branch outcome for a settled Join attempt (US3 AS3/AS4, FR-007). */
export default function JoinBranchOutcomes({
  branches
}: JoinBranchOutcomesProps): React.JSX.Element {
  return (
    <InspectorField
      label={translate('auto.components.workflows.run-view.JoinBranchOutcomes.label', 'Branches')}
    >
      <ul className="space-y-1">
        {Object.entries(branches).map(([sourceId, outcome]) => (
          <li key={sourceId} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-mono">{sourceId}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-foreground">
              <span
                className={cn('size-2 rounded-full', outcomeDotClassName(outcome))}
                aria-hidden="true"
              />
              {outcomeLabel(outcome)}
            </span>
          </li>
        ))}
      </ul>
    </InspectorField>
  )
}
