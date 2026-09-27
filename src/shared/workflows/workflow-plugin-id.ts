// A plugin-sourced skill's id: `name` or `name@marketplace`. It becomes a plugin CLI argument and
// part of a trust key, so a leading `-` (read as an option) or `[` (an encoded host key) is refused.
const PLUGIN_ID_SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]*'
const PLUGIN_ID_PATTERN = new RegExp(`^${PLUGIN_ID_SEGMENT}(@${PLUGIN_ID_SEGMENT})?$`)

export const WORKFLOW_PLUGIN_ID_MESSAGE =
  'Plugin id must be name or name@marketplace: letters, digits, ".", "_" and "-", starting with a letter or digit.'

export function isWorkflowPluginId(value: string): boolean {
  return PLUGIN_ID_PATTERN.test(value)
}
