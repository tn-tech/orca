import { describe, expect, it } from 'vitest'
import { workflowNodeStatusDotClassName } from './workflow-node-run-status-style'

describe('workflowNodeStatusDotClassName', () => {
  it('gives every non-editing state a dot class', () => {
    expect(workflowNodeStatusDotClassName('provisioning')).toBe('bg-workspace-status-progress')
    expect(workflowNodeStatusDotClassName('running')).toBe('bg-workspace-status-progress')
    expect(workflowNodeStatusDotClassName('waiting')).toBe('bg-workspace-status-review')
    expect(workflowNodeStatusDotClassName('unverifiable')).toBe('bg-workspace-status-review')
    expect(workflowNodeStatusDotClassName('completed')).toBe('bg-status-success')
    expect(workflowNodeStatusDotClassName('failed')).toBe('bg-destructive')
    expect(workflowNodeStatusDotClassName('skipped')).toBe('bg-muted-foreground')
    expect(workflowNodeStatusDotClassName('pending')).toBeUndefined()
    expect(workflowNodeStatusDotClassName(undefined)).toBeUndefined()
  })

  it('gives cancelled the same neutral treatment as skipped, not the destructive failed color (review note)', () => {
    expect(workflowNodeStatusDotClassName('cancelled')).toBe('bg-muted-foreground')
    expect(workflowNodeStatusDotClassName('cancelled')).not.toBe(
      workflowNodeStatusDotClassName('failed')
    )
  })
})
