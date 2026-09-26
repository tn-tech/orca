// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentNode } from '../../../../../shared/workflows/workflow-definition-types'
import AgentNodeResultContractField from './AgentNodeResultContractField'

afterEach(() => {
  cleanup()
})

function agentNode(patch: Partial<AgentNode> = {}): AgentNode {
  return {
    id: 'implement',
    type: 'agent',
    title: 'Implement',
    prompt: 'Build it.',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 600_000, escalationGraceMs: 300_000 },
    ...patch
  }
}

/** A real parent (NodeInspector, via the reducer) always echoes a committed edit back as the
 *  next `node` prop; this harness does the same so interaction tests exercise the actual
 *  controlled contract, not a `node` prop frozen at its initial value. */
function ControlledResultContractField({
  initial,
  onChange
}: {
  initial: AgentNode
  onChange: (node: AgentNode) => void
}) {
  const [node, setNode] = useState(initial)
  return (
    <AgentNodeResultContractField
      node={node}
      onChange={(next) => {
        setNode(next)
        onChange(next)
      }}
    />
  )
}

describe('AgentNodeResultContractField', () => {
  it('associates its label with the textarea for accessibility', () => {
    render(<AgentNodeResultContractField node={agentNode()} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Result contract (JSON schema)')).toBe(screen.getByRole('textbox'))
  })

  it('commits valid JSON edits', () => {
    const onChange = vi.fn<(node: AgentNode) => void>()
    render(<ControlledResultContractField initial={agentNode()} onChange={onChange} />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '{"type": "object", "properties": {"approved": {"type": "boolean"}}}' }
    })

    const last = onChange.mock.calls.at(-1)?.[0]
    expect(last?.resultContract).toEqual({
      type: 'object',
      properties: { approved: { type: 'boolean' } }
    })
    expect(screen.queryByText(/needs "type"/)).not.toBeInTheDocument()
  })

  it('shows an error and keeps the invalid draft instead of committing it', () => {
    const onChange = vi.fn()
    render(<AgentNodeResultContractField node={agentNode()} onChange={onChange} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{not json' } })

    expect(screen.getByText('Not valid JSON.')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('{not json')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('resyncs its draft when resultContract changes externally while the node stays selected', () => {
    // Simulates undo/redo or another client editing the same node: the `node` prop changes
    // without this field's own `onChange` having produced it.
    const onChange = vi.fn()
    const { rerender } = render(
      <AgentNodeResultContractField node={agentNode()} onChange={onChange} />
    )
    expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ type: 'object' }, null, 2))

    const externallyChanged = agentNode({
      resultContract: { type: 'object', properties: { approved: { type: 'boolean' } } }
    })
    rerender(<AgentNodeResultContractField node={externallyChanged} onChange={onChange} />)

    expect(screen.getByRole('textbox')).toHaveValue(
      JSON.stringify(externallyChanged.resultContract, null, 2)
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not resync mid-typing while the draft is invalid JSON (resultContract prop unchanged)', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <AgentNodeResultContractField node={agentNode()} onChange={onChange} />
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{"type": "object"' } })
    expect(screen.getByText('Not valid JSON.')).toBeInTheDocument()

    // Same node re-rendered (e.g. a sibling field edit) — the invalid draft must survive.
    rerender(<AgentNodeResultContractField node={agentNode()} onChange={onChange} />)

    expect(screen.getByRole('textbox')).toHaveValue('{"type": "object"')
  })
})
