// A Loop that reaches its cap fails the run at that point (spec edge case "A Loop reaches its
// cap", Assumptions): nothing more launches and live siblings are stopped the way cancel stops
// them. Other node failures let running siblings finish; only the run verdict changes.
import type { WorkerStopCause } from './workflow-join-branch-stop'
import { stopRunAttempts } from './workflow-run-control'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'

const LOOP_CAP_REASON = 'loop_cap_reached'

export async function stopRunAtLoopCap(
  ctx: WorkflowNodeLaunchContext,
  loopId: string
): Promise<void> {
  // Failed first, as cancel does: no later tick launches anything, and open questions close.
  ctx.recorder.transitionRun('failed', 'run_failed', {
    reason: 'node_failed',
    failedNodes: [loopId],
    failureReason: LOOP_CAP_REASON
  })
  const cause: WorkerStopCause = {
    eventPrefix: 'loop_cap_stop',
    reason: LOOP_CAP_REASON,
    subject: { loopNodeId: loopId }
  }
  await stopRunAttempts(ctx, cause)
}
