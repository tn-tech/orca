// Worker-lifecycle seams for draft teardown tests: the harness's fake terminals can never prove a
// process exited, so a stop is `stop_unknown` unless a test opts into a proven one here.
import { vi } from 'vitest'
import { RpcDispatcher } from '../rpc/dispatcher'
import type { createControllerHarness } from './workflow-run-controller-test-harness'

type Harness = ReturnType<typeof createControllerHarness>

/** Every engine worker-stop settles as a proven exit (what a verified close records), then says so. */
export function confirmWorkerStops(h: Harness): void {
  vi.spyOn(h.dispatcher, 'dispatchAsWorkflowEngine').mockImplementation(
    async (request, principal, options) => {
      const dispatchId = request.params
        ? Reflect.get(Object(request.params), 'dispatch')
        : undefined
      if (request.method !== 'orchestration.workerStop' || typeof dispatchId !== 'string') {
        return RpcDispatcher.prototype.dispatchAsWorkflowEngine.call(
          h.dispatcher,
          request,
          principal,
          options
        )
      }
      h.db.beginWorkerStop(dispatchId, h.runtime.getRuntimeId())
      h.db.settleWorkerStop(dispatchId)
      return {
        id: request.id,
        ok: true,
        result: { dispatchId, state: 'stopped', alreadySettled: false },
        _meta: { runtimeId: h.runtime.getRuntimeId() }
      }
    }
  )
}

/** Holds the next worker terminal's creation until `release()`, as a slow TUI launch would. */
export function holdNextWorkerTerminal(h: Harness): { release: () => void; held: () => boolean } {
  const created = h.runtime.createTerminal.bind(h.runtime)
  let release = (): void => {}
  let held = false
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(h.runtime, 'createTerminal').mockImplementationOnce(async (...args) => {
    held = true
    await gate
    return created(...args)
  })
  return { release, held: () => held }
}
