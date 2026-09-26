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
import RoleDispatchFields from './RoleDispatchFields'

export type RouterNodeFieldsProps = {
  node: RouterNode
  roles: Workflow['roles']
  onChange: (node: RouterNode) => void
}

type RouterOverrides = NonNullable<RouterNode['overrides']>

const OVERRIDE_KEYS: readonly (keyof RouterOverrides)[] = [
  'agent',
  'model',
  'effort',
  'systemPrompt',
  'skills'
]

function withOverrides(node: RouterNode, patch: Partial<RouterOverrides>): RouterNode {
  const merged: RouterOverrides = { ...node.overrides, ...patch }
  for (const key of OVERRIDE_KEYS) {
    if (merged[key] === undefined) {
      delete merged[key]
    }
  }
  return { ...node, overrides: Object.keys(merged).length > 0 ? merged : undefined }
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
  const effectiveAgent = node.overrides?.agent ?? role?.agent
  const effectiveModel = node.overrides?.model ?? role?.model
  const effectiveEffort = node.overrides?.effort ?? role?.effort

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
      <RoleDispatchFields
        agent={effectiveAgent}
        model={effectiveModel}
        effort={effectiveEffort}
        prompt={node.prompt}
        onAgentChange={(agent) =>
          onChange(withOverrides(node, { agent, model: undefined, effort: undefined }))
        }
        onModelChange={(model) => onChange(withOverrides(node, { model, effort: undefined }))}
        onEffortChange={(effort) => onChange(withOverrides(node, { effort }))}
        onPromptChange={(prompt) => onChange({ ...node, prompt })}
      />

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
        <Button type="button" variant="outline" size="sm" onClick={addChoice}>
          <Plus />
          {translate('auto.components.workflows.editor.RouterNodeFields.addChoice', 'Add choice')}
        </Button>
      </InspectorField>
    </>
  )
}
