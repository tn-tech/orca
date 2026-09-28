import React, { useRef } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type {
  RouterNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { InspectorField } from './InspectorField'
import { NodeRoleDispatchFields } from './RoleDispatchFields'
import { invalidChoiceIndices } from './workflow-router-choices'

export type RouterNodeFieldsProps = {
  node: RouterNode
  roles: Workflow['roles']
  onChange: (node: RouterNode) => void
}

/** Router node settings (FR-029, data-model.md §1 RouterNode): the same role/overrides/prompt
 *  fields an Agent node has, plus the fixed choice list — one outgoing port per choice, wired
 *  to `Edge.fromPort` by `RouterNode.tsx` on the canvas (choice text is the port id). */
export default function RouterNodeFields({
  node,
  roles,
  onChange
}: RouterNodeFieldsProps): React.JSX.Element {
  const role = node.roleId ? roles[node.roleId] : undefined

  // Why: choices have no id of their own; a stable per-row key keeps a row's input (and focus)
  // attached to that row when a different row is removed, instead of the array index. Lazy-
  // seeded (lazy-use-ref-ratchet.test.ts) so this isn't recomputed on every render.
  const rowKeysRef = useRef<string[]>(undefined!)
  rowKeysRef.current ??= node.choices.map(() => createBrowserUuid())
  const keyedChoices = node.choices.map((choice, index) => ({
    rowKey: rowKeysRef.current[index] ?? createBrowserUuid(),
    choice,
    index
  }))
  const invalidIndices = invalidChoiceIndices(node.choices)

  function updateChoice(index: number, value: string): void {
    onChange({ ...node, choices: node.choices.map((choice, i) => (i === index ? value : choice)) })
  }

  function removeChoice(index: number): void {
    if (node.choices.length <= 1) {
      return
    }
    rowKeysRef.current = rowKeysRef.current.filter((_, i) => i !== index)
    onChange({ ...node, choices: node.choices.filter((_, i) => i !== index) })
  }

  function addChoice(): void {
    rowKeysRef.current = [...rowKeysRef.current, createBrowserUuid()]
    onChange({ ...node, choices: [...node.choices, ''] })
  }

  return (
    <>
      <NodeRoleDispatchFields node={node} role={role} onChange={onChange} />

      <InspectorField
        label={translate(
          'auto.components.workflows.editor.RouterNodeFields.choicesLabel',
          'Choices'
        )}
      >
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.editor.RouterNodeFields.choicesHelp',
            'Each choice gets exactly one outgoing edge on the canvas; the agent must report one of these exactly.'
          )}
        </p>
        <div className="space-y-1.5">
          {keyedChoices.map(({ rowKey, choice, index }) => (
            <div key={rowKey} className="flex items-center gap-1.5">
              <Input
                value={choice}
                onChange={(event) => updateChoice(index, event.target.value)}
                placeholder={translate(
                  'auto.components.workflows.editor.RouterNodeFields.choicePlaceholder',
                  'e.g. bugfix'
                )}
                className="h-8 min-w-0 flex-1"
                aria-label={translate(
                  'auto.components.workflows.editor.RouterNodeFields.choiceLabel',
                  'Choice'
                )}
                aria-invalid={invalidIndices.has(index)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => removeChoice(index)}
                disabled={node.choices.length <= 1}
                aria-label={translate(
                  'auto.components.workflows.editor.RouterNodeFields.removeChoice',
                  'Remove choice'
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
              'auto.components.workflows.editor.RouterNodeFields.invalidChoices',
              'Choices must be non-empty and unique — a blank or repeated choice gets no outgoing edge.'
            )}
          </p>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={addChoice}>
          <Plus />
          {translate('auto.components.workflows.editor.RouterNodeFields.addChoice', 'Add choice')}
        </Button>
      </InspectorField>
    </>
  )
}
