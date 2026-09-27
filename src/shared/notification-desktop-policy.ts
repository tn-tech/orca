import type { NotificationSettings } from './notification-settings-types'

/**
 * Whether the user's notification settings allow a desktop banner for `source`. Also what paired
 * phones are told through `desktopAllowed`: a push is never sent for a notification the user
 * turned off.
 */
export function isDesktopNotificationAllowed(
  settings: Pick<NotificationSettings, 'enabled' | 'agentTaskComplete' | 'terminalBell'>,
  source: string
): boolean {
  return (
    settings.enabled &&
    (source !== 'agent-task-complete' || settings.agentTaskComplete) &&
    (source !== 'terminal-bell' || settings.terminalBell)
  )
}
