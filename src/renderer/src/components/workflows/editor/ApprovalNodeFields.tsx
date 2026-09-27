import React, { useId, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { ApprovalNode } from '../../../../../shared/workflows/workflow-definition-types'
import { InspectorField } from './InspectorField'
import { invalidChoiceIndices, routableChoiceIndices } from './workflow-router-choices'

export type ApprovalNodeFieldsProps = {
  node: ApprovalNode
  onChange: (node: ApprovalNode) => void
}

const NO_DEFAULT = '__no_default__'

/** `undefined` for anything that isn't a plain positive integer of minutes — mirrors
 *  `JoinNodeFields`'s `parseValidQuorum`: the caller keeps the user's draft text on screen until
 *  it parses rather than snapping back mid-edit. */
function parsePositiveMinutes(text: string): number | undefined {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) {
    return undefined
  }
  const parsed = Number.parseInt(trimmed, 10)
  return parsed >= 1 ? parsed : undefined
}

/** A minutes-granularity draft for an ms field (`timeoutMs`/`escalationGraceMs`), resyncing only
 *  when the committed value changes for a reason other than this hook's own commit (switching
 *  nodes, undo/redo) — same resync pattern as `JoinNodeFields`'s quorum draft. */
function useDurationMinutesField(
  committedMs: number,
  onCommitMs: (ms: number) => void
): { draft: string; parsed: number | undefined; setDraft: (text: string) => void } {
  const committedMinutes = Math.max(1, Math.round(committedMs / 60_000))
  const [draft, setDraftState] = useState(() => String(committedMinutes))
  const [synced, setSynced] = useState(committedMinutes)
  if (committedMinutes !== synced) {
    setSynced(committedMinutes)
    setDraftState(String(committedMinutes))
  }
  function setDraft(text: string): void {
    setDraftState(text)
    const parsed = parsePositiveMinutes(text)
    if (parsed !== undefined) {
      onCommitMs(parsed * 60_000)
    }
  }
  return { draft, parsed: parsePositiveMinutes(draft), setDraft }
}

/** Approval node settings (FR-033, data-model.md §1 ApprovalNode): the question, its fixed option
 *  list — one outgoing port per option, wired to `Edge.fromPort` by `ApprovalNode.tsx` on the
 *  canvas, the same convention `RouterNodeFields` uses for choices — a default answer for the
 *  timeout, and the timeout/escalation-grace periods. */
export default function ApprovalNodeFields({
  node,
  onChange
}: ApprovalNodeFieldsProps): React.JSX.Element {
  const questionId = useId()
  const rowKeysRef = useRef<string[]>(undefined!)
  rowKeysRef.current ??= node.options.map(() => createBrowserUuid())
  const keyedOptions = node.options.map((option, index) => ({
    rowKey: rowKeysRef.current[index] ?? createBrowserUuid(),
    option,
    index
  }))
  const invalidIndices = invalidChoiceIndices(node.options)
  const routableOptions = [...routableChoiceIndices(node.options)].map(
    (index) => node.options[index]
  )

  const timeout = useDurationMinutesField(node.timeoutMs, (timeoutMs) =>
    onChange({ ...node, timeoutMs })
  )
  const escalation = useDurationMinutesField(node.escalationGraceMs, (escalationGraceMs) =>
    onChange({ ...node, escalationGraceMs })
  )

  function updateOption(index: number, value: string): void {
    onChange({ ...node, options: node.options.map((option, i) => (i === index ? value : option)) })
  }

  function removeOption(index: number): void {
    if (node.options.length <= 1) {
      return
    }
    rowKeysRef.current = rowKeysRef.current.filter((_, i) => i !== index)
    const removed = node.options[index]
    onChange({
      ...node,
      options: node.options.filter((_, i) => i !== index),
      defaultOption: node.defaultOption === removed ? undefined : node.defaultOption
    })
  }

  function addOption(): void {
    rowKeysRef.current = [...rowKeysRef.current, createBrowserUuid()]
    onChange({ ...node, options: [...node.options, ''] })
  }

  return (
    <>
      <InspectorField
        htmlFor={questionId}
        label={translate(
          'auto.components.workflows.editor.ApprovalNodeFields.questionLabel',
          'Question'
        )}
      >
        <Textarea
          id={questionId}
          value={node.question}
          onChange={(event) => onChange({ ...node, question: event.target.value })}
          className="min-h-16"
        />
      </InspectorField>

      <InspectorField
        label={translate(
          'auto.components.workflows.editor.ApprovalNodeFields.optionsLabel',
          'Options'
        )}
      >
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.editor.ApprovalNodeFields.optionsHelp',
            'Each option gets exactly one outgoing edge on the canvas; the answer must match one of these exactly.'
          )}
        </p>
        <div className="space-y-1.5">
          {keyedOptions.map(({ rowKey, option, index }) => (
            <div key={rowKey} className="flex items-center gap-1.5">
              <Input
                value={option}
                onChange={(event) => updateOption(index, event.target.value)}
                placeholder={translate(
                  'auto.components.workflows.editor.ApprovalNodeFields.optionPlaceholder',
                  'e.g. Approve'
                )}
                className="h-8 min-w-0 flex-1"
                aria-label={translate(
                  'auto.components.workflows.editor.ApprovalNodeFields.optionLabel',
                  'Option'
                )}
                aria-invalid={invalidIndices.has(index)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => removeOption(index)}
                disabled={node.options.length <= 1}
                aria-label={translate(
                  'auto.components.workflows.editor.ApprovalNodeFields.removeOption',
                  'Remove option'
                )}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        {invalidIndices.size > 0 ? (
          <p className="text-xs text-destructive">
            {translate(
              'auto.components.workflows.editor.ApprovalNodeFields.invalidOptions',
              'Options must be non-empty and unique — a blank or repeated option gets no outgoing edge.'
            )}
          </p>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={addOption}>
          <Plus />
          {translate('auto.components.workflows.editor.ApprovalNodeFields.addOption', 'Add option')}
        </Button>
      </InspectorField>

      <InspectorField
        label={translate(
          'auto.components.workflows.editor.ApprovalNodeFields.defaultOptionLabel',
          'Default answer'
        )}
      >
        <Select
          value={node.defaultOption ?? NO_DEFAULT}
          onValueChange={(value) =>
            onChange({ ...node, defaultOption: value === NO_DEFAULT ? undefined : value })
          }
        >
          <SelectTrigger
            className="h-8 w-full"
            aria-label={translate(
              'auto.components.workflows.editor.ApprovalNodeFields.defaultOptionLabel',
              'Default answer'
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_DEFAULT}>
              {translate(
                'auto.components.workflows.editor.ApprovalNodeFields.noDefault',
                'No default (the node fails on timeout)'
              )}
            </SelectItem>
            {routableOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </InspectorField>

      <InspectorField
        label={translate(
          'auto.components.workflows.editor.ApprovalNodeFields.timeoutLabel',
          'Timeout (minutes)'
        )}
      >
        <Input
          type="number"
          min={1}
          step={1}
          value={timeout.draft}
          onChange={(event) => timeout.setDraft(event.target.value)}
          aria-label={translate(
            'auto.components.workflows.editor.ApprovalNodeFields.timeoutLabel',
            'Timeout (minutes)'
          )}
          aria-invalid={timeout.parsed === undefined}
          className="h-8 w-24"
        />
        {timeout.parsed === undefined ? (
          <p className="text-xs text-destructive">
            {translate(
              'auto.components.workflows.editor.ApprovalNodeFields.durationInvalid',
              'Enter a whole number of minutes, 1 or more.'
            )}
          </p>
        ) : null}
      </InspectorField>

      <InspectorField
        label={translate(
          'auto.components.workflows.editor.ApprovalNodeFields.escalationLabel',
          'Escalation grace (minutes)'
        )}
      >
        <Input
          type="number"
          min={1}
          step={1}
          value={escalation.draft}
          onChange={(event) => escalation.setDraft(event.target.value)}
          aria-label={translate(
            'auto.components.workflows.editor.ApprovalNodeFields.escalationLabel',
            'Escalation grace (minutes)'
          )}
          aria-invalid={escalation.parsed === undefined}
          className="h-8 w-24"
        />
        {escalation.parsed === undefined ? (
          <p className="text-xs text-destructive">
            {translate(
              'auto.components.workflows.editor.ApprovalNodeFields.durationInvalid',
              'Enter a whole number of minutes, 1 or more.'
            )}
          </p>
        ) : null}
      </InspectorField>
    </>
  )
}
