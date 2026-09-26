import React, { useRef } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { AgentNode } from '../../../../../shared/workflows/workflow-definition-types'
import { InspectorField } from './InspectorField'

export type AgentNodeArtifactsFieldProps = {
  node: AgentNode
  onChange: (node: AgentNode) => void
}

/** The artifacts an Agent node is expected to produce (FR-003): path + required flag, editable
 *  as an add/remove list. */
export default function AgentNodeArtifactsField({
  node,
  onChange
}: AgentNodeArtifactsFieldProps): React.JSX.Element {
  // Why: artifacts have no id of their own; a stable per-row key keeps a row's inputs (and
  // focus) attached to that row when a different row is removed, instead of the array index.
  const rowKeysRef = useRef<string[]>(node.artifacts.map(() => createBrowserUuid()))
  const keyedArtifacts = node.artifacts.map((artifact, index) => ({
    rowKey: rowKeysRef.current[index] ?? createBrowserUuid(),
    artifact,
    index
  }))

  function updateArtifact(index: number, patch: Partial<AgentNode['artifacts'][number]>): void {
    onChange({
      ...node,
      artifacts: node.artifacts.map((artifact, i) =>
        i === index ? { ...artifact, ...patch } : artifact
      )
    })
  }

  function removeArtifact(index: number): void {
    rowKeysRef.current = rowKeysRef.current.filter((_, i) => i !== index)
    onChange({ ...node, artifacts: node.artifacts.filter((_, i) => i !== index) })
  }

  function addArtifact(): void {
    rowKeysRef.current = [...rowKeysRef.current, createBrowserUuid()]
    onChange({ ...node, artifacts: [...node.artifacts, { path: '', required: true }] })
  }

  return (
    <InspectorField
      label={translate(
        'auto.components.workflows.editor.AgentNodeArtifactsField.label',
        'Artifacts'
      )}
    >
      <div className="space-y-1.5">
        {keyedArtifacts.map(({ rowKey, artifact, index }) => (
          <div key={rowKey} className="flex items-center gap-1.5">
            <Input
              value={artifact.path}
              onChange={(event) => updateArtifact(index, { path: event.target.value })}
              placeholder={translate(
                'auto.components.workflows.editor.AgentNodeArtifactsField.pathPlaceholder',
                'workspace-relative path'
              )}
              className="h-8 min-w-0 flex-1"
            />
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={artifact.required}
                onCheckedChange={(checked) => updateArtifact(index, { required: checked === true })}
              />
              {translate(
                'auto.components.workflows.editor.AgentNodeArtifactsField.required',
                'Required'
              )}
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => removeArtifact(index)}
              aria-label={translate(
                'auto.components.workflows.editor.AgentNodeArtifactsField.removeArtifact',
                'Remove artifact'
              )}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addArtifact}>
        <Plus />
        {translate(
          'auto.components.workflows.editor.AgentNodeArtifactsField.addArtifact',
          'Add artifact'
        )}
      </Button>
    </InspectorField>
  )
}
