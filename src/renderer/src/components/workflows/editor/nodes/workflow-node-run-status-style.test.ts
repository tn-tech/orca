import { describe, expect, it } from 'vitest'
import { workflowNodeStatusDotClassName } from './workflow-node-run-status-style'

describe('workflowNodeStatusDotClassName', () => {
  it('gives every non-editing state a dot class', () => {
    expect(workflowNodeStatusDotClassName('provisioning')).toBe('bg-workspace-status-progress')
    expect(workflowNodeStatusDotClassName('running')).toBe('bg-workspace-status-progress')
    expect(workflowNodeStatusDotClassName('unverifiable')).toBe('bg-workspace-status-review')
    expect(workflowNodeStatusDotClassName('completed')).toBe('bg-status-success')
    expect(workflowNodeStatusDotClassName('failed')).toBe('bg-destructive')
    expect(workflowNodeStatusDotClassName('skipped')).toBe('bg-muted-foreground')
    expect(workflowNodeStatusDotClassName('pending')).toBeUndefined()
    expect(workflowNodeStatusDotClassName(undefined)).toBeUndefined()
  })

  it('draws Waiting as a hollow progress-colour ring, never the Completed green (N10)', () => {
    const waiting = workflowNodeStatusDotClassName('waiting')
    expect(waiting).toBe('border-2 border-workspace-status-progress bg-transparent')
    expect(waiting).not.toContain('bg-status-success')
    expect(waiting).not.toContain('workspace-status-review')
  })

  it('gives cancelled the same neutral treatment as skipped, not the destructive failed color (review note)', () => {
    expect(workflowNodeStatusDotClassName('cancelled')).toBe('bg-muted-foreground')
    expect(workflowNodeStatusDotClassName('cancelled')).not.toBe(
      workflowNodeStatusDotClassName('failed')
    )
  })
})
