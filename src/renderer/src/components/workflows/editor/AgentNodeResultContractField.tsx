import React, { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { AgentNode } from '../../../../../shared/workflows/workflow-definition-types'
import { InspectorField } from './InspectorField'

type ResultContractParseResult =
  | { ok: true; value: AgentNode['resultContract'] }
  | { ok: false; error: string }

/** Narrows a parsed JSON object to `ResultContract` (needs `type: 'object'`) without a cast. */
function isResultContractDraft(value: object): value is AgentNode['resultContract'] {
  return !Array.isArray(value) && Reflect.get(value, 'type') === 'object'
}

function parseResultContract(text: string): ResultContractParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      ok: false,
      error: translate(
        'auto.components.workflows.editor.AgentNodeResultContractField.invalidJson',
        'Not valid JSON.'
      )
    }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {
      ok: false,
      error: translate(
        'auto.components.workflows.editor.AgentNodeResultContractField.mustBeObject',
        'The result contract must be a JSON object.'
      )
    }
  }
  if (!isResultContractDraft(parsed)) {
    return {
      ok: false,
      error: translate(
        'auto.components.workflows.editor.AgentNodeResultContractField.mustBeObjectType',
        'The result contract needs "type": "object".'
      )
    }
  }
  return { ok: true, value: parsed }
}

export type AgentNodeResultContractFieldProps = {
  node: AgentNode
  onChange: (node: AgentNode) => void
}

/** JSON editor for an Agent node's result contract (FR-003), with parse validation; a textarea
 *  primitive since no code/JSON editor component exists yet in the renderer. */
export default function AgentNodeResultContractField({
  node,
  onChange
}: AgentNodeResultContractFieldProps): React.JSX.Element {
  const [text, setText] = useState(() => JSON.stringify(node.resultContract, null, 2))
  const [error, setError] = useState<string | undefined>(undefined)

  function handleChange(nextText: string): void {
    setText(nextText)
    const result = parseResultContract(nextText)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(undefined)
    onChange({ ...node, resultContract: result.value })
  }

  return (
    <InspectorField
      label={translate(
        'auto.components.workflows.editor.AgentNodeResultContractField.label',
        'Result contract (JSON schema)'
      )}
    >
      <Textarea
        value={text}
        onChange={(event) => handleChange(event.target.value)}
        spellCheck={false}
        className="min-h-32"
        aria-invalid={error !== undefined}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </InspectorField>
  )
}
