// Live controllers by workflow run id, so an out-of-band answer (workflow.trust.decide) can make
// its run re-read persisted state now. A run with no live controller catches up on rehydrate.
const liveRunWakers = new Map<string, () => void>()

/** Returns the unregister function; it only removes this exact registration. */
export function registerWorkflowRunWaker(workflowRunId: string, wake: () => void): () => void {
  liveRunWakers.set(workflowRunId, wake)
  return () => {
    if (liveRunWakers.get(workflowRunId) === wake) {
      liveRunWakers.delete(workflowRunId)
    }
  }
}

export function wakeWorkflowRun(workflowRunId: string): void {
  liveRunWakers.get(workflowRunId)?.()
}
