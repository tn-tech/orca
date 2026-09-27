import type { RpcContext } from '../../core'

/**
 * Who answered, sent, decided or started, as recorded on a run and read back by every paired
 * client. Why never `clientId`: for a WebSocket caller it is the device's bearer token.
 */
export function workflowCallerIdentity(
  ctx: Pick<RpcContext, 'pairedDeviceId' | 'clientKind'>
): string {
  return ctx.pairedDeviceId ?? ctx.clientKind ?? 'user'
}
