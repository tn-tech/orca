import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { getExperimentalSearchEntry } from './experimental-search'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'

type WorkflowsExperimentalSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function WorkflowsExperimentalSetting({
  settings,
  updateSettings
}: WorkflowsExperimentalSettingProps): React.JSX.Element {
  const entry = getExperimentalSearchEntry().workflows
  const enabled = settings.experimentalWorkflows === true

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="space-y-3 py-2"
      id="experimental-workflows"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>{entry.title}</Label>
          <p className="text-xs text-muted-foreground">{entry.description}</p>
        </div>
        <SettingsSwitch
          checked={enabled}
          ariaLabel={translate(
            'auto.components.settings.experimental.workflows.toggleLabel',
            'Toggle Workflows'
          )}
          onChange={() =>
            // F6: re-enabling always restores the sidebar button. A user who hid it (SidebarNav's
            // "Hide") otherwise has no way back in besides this easy-to-miss Appearance setting —
            // and turning the experiment back on is the intuitive way to ask for it again.
            updateSettings(
              enabled
                ? { experimentalWorkflows: false }
                : { experimentalWorkflows: true, showWorkflowsButton: true }
            )
          }
        />
      </div>
    </SearchableSetting>
  )
}
