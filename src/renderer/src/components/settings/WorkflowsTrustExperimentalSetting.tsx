import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { Label } from '../ui/label'
import TrustedSourcesList from '../workflows/TrustedSourcesList'
import { getExperimentalSearchEntry } from './experimental-search'
import { SearchableSetting } from './SearchableSetting'

type WorkflowsTrustExperimentalSettingProps = {
  settings: GlobalSettings
}

/** FR-018a "revocable from settings": the per-source, per-host trust decisions a workflow run
 *  recorded (`workflow.trust.decide`/`.revoke`), shown only while Workflows itself is on — this
 *  reads/writes decisions, it doesn't gate the feature. `WorkflowsPage`'s "Trusted sources" button
 *  opens `TrustedSourcesDialog`, the same underlying `TrustedSourcesList`. */
export function WorkflowsTrustExperimentalSetting({
  settings
}: WorkflowsTrustExperimentalSettingProps): React.JSX.Element {
  const entry = getExperimentalSearchEntry().workflowsTrust

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="max-w-none space-y-3 py-2"
      id="workflows-trust"
    >
      <div className="space-y-0.5">
        <Label>{entry.title}</Label>
        <p className="text-xs text-muted-foreground">{entry.description}</p>
      </div>
      <TrustedSourcesList settings={settings} />
    </SearchableSetting>
  )
}
