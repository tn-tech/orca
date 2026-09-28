import React, { useId, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { AgentNode } from '../../../../../shared/workflows/workflow-definition-types'
import { InspectorField } from './InspectorField'

type ResultContractParseResult =
  | { ok: true; value: AgentNode['resultContract'] }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Narrows a parsed JSON object to `ResultContract` (needs `type: 'object'`) without a cast. */
function isResultContractDraft(
  value: Record<string, unknown>
): value is AgentNode['resultContract'] {
  return !Array.isArray(value) && value.type === 'object'
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
  if (!isRecord(parsed)) {
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

/** Content comparison (not `===`) so our own committed edit — a new-but-equal object round-
 *  tripping back through props — is never mistaken for an external change. */
function resultContractsMatch(
  a: AgentNode['resultContract'],
  b: AgentNode['resultContract']
): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
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
  const fieldId = useId()
  const [text, setText] = useState(() => JSON.stringify(node.resultContract, null, 2))
  const [error, setError] = useState<string | undefined>(undefined)
  // The resultContract value `text` currently reflects — either the initial prop, or the last
  // value we ourselves committed. Compared by content, not identity, below.
  const [syncedContract, setSyncedContract] = useState(node.resultContract)

  // Resync when `node.resultContract` changes without going through `handleChange` below — e.g.
  // undo/redo or another client editing the same node while it stays selected. A no-op for our
  // own edits (which update `syncedContract` in lockstep) and never fires while the draft is
  // invalid JSON, since we only call `onChange` — and so only ever move `syncedContract` — once
  // parsing succeeds.
  if (!resultContractsMatch(node.resultContract, syncedContract)) {
    setSyncedContract(node.resultContract)
    setText(JSON.stringify(node.resultContract, null, 2))
    setError(undefined)
  }

  function handleChange(nextText: string): void {
    setText(nextText)
    const result = parseResultContract(nextText)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(undefined)
    setSyncedContract(result.value)
    onChange({ ...node, resultContract: result.value })
  }

  return (
    <InspectorField
      htmlFor={fieldId}
      label={translate(
        'auto.components.workflows.editor.AgentNodeResultContractField.label',
        'Result contract (JSON schema)'
      )}
    >
      <Textarea
        id={fieldId}
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
