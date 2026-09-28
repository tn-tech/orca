import { translate } from '@/i18n/i18n'
import type { SettingsSearchEntry } from './settings-search'
import { translateSearchKeyword } from './settings-search-keywords'

export function getWorkflowsExperimentalSearchEntry(): SettingsSearchEntry {
  return {
    title: translate('auto.components.settings.experimental.search.workflows.title', 'Workflows'),
    description: translate(
      'auto.components.settings.experimental.search.workflows.description',
      'Visual DAG automation that chains agent and tool steps into a repeatable run.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.0d24759f14',
        'experimental'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.workflows.workflow',
        'workflow'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.workflows.dag',
        'dag'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.workflows.automation',
        'automation'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.workflows.pipeline',
        'pipeline'
      )
    ]
  }
}
