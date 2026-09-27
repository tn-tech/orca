import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceRegistry } from './device-registry'
import { ALL_RPC_METHODS } from './rpc/methods'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { createMobileRpcSurfaceRuntime } from './runtime-rpc-mobile-method-allowlist-fixtures'
import { MOBILE_RPC_METHOD_ALLOWLIST } from './runtime-rpc/runtime-rpc-mobile-method-allowlist'

// Spec US5: any paired client, the phone included, can see a run and answer its questions.
const MOBILE_WORKFLOW_METHODS = [
  'workflow.run.list',
  'workflow.run.show',
  'workflow.run.answer',
  'workflow.run.events'
]

async function errorCodeForMobile(method: string): Promise<unknown> {
  const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-workflow-'))
  const { runtime } = createMobileRpcSurfaceRuntime()
  const server = new OrcaRuntimeRpcServer({ runtime, userDataPath, enableWebSocket: false })
  try {
    // No public seam installs a registry without starting the listener; the sibling
    // allowlist suites reach it the same way.
    const registry = new DeviceRegistry(userDataPath)
    server['deviceRegistry'] = registry
    const phone = registry.addDevice('phone', 'mobile')
    const replies: { error?: { code?: unknown } }[] = []
    await server['handleWebSocketMessage'](
      JSON.stringify({ id: 'req_1', method, deviceToken: phone.token, params: {} }),
      (response) => replies.push(JSON.parse(response)),
      () => {}
    )
    return replies[0]?.error?.code
  } finally {
    await server.stop()
    rmSync(userDataPath, { recursive: true, force: true })
  }
}

describe('mobile workflow run surface (T110)', () => {
  it.each(MOBILE_WORKFLOW_METHODS)('allowlists and registers %s', async (method) => {
    expect(MOBILE_RPC_METHOD_ALLOWLIST.has(method)).toBe(true)
    expect(ALL_RPC_METHODS.some((registered) => registered.name === method)).toBe(true)
    expect(await errorCodeForMobile(method)).not.toBe('forbidden')
  })

  it.each(['workflow.run.start', 'workflow.run.cancel', 'workflow.trust.decide', 'workflow.write'])(
    'keeps %s desktop-only',
    async (method) => {
      expect(MOBILE_RPC_METHOD_ALLOWLIST.has(method)).toBe(false)
      expect(await errorCodeForMobile(method)).toBe('forbidden')
    }
  )
})
