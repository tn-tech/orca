import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getWorkflowsTrustSearchEntry = createLocalizedCatalog((): SettingsSearchEntry => ({
  title: translate('auto.components.settings.workflowsTrust.search.title', 'Trusted skill sources'),
  description: translate(
    'auto.components.settings.workflowsTrust.search.description',
    'Review and revoke the plugin sources a workflow run has been allowed to install skills from, per host.'
  ),
  keywords: [
    ...translateSearchKeyword(
      'auto.components.settings.experimental.search.0d24759f14',
      'experimental'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.workflowsTrust.search.keywordWorkflows',
      'workflows'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.workflowsTrust.search.keywordTrust',
      'trust'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.workflowsTrust.search.keywordSkills',
      'skills'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.workflowsTrust.search.keywordPlugin',
      'plugin'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.workflowsTrust.search.keywordRevoke',
      'revoke'
    )
  ],
  targetSectionId: 'workflows-trust'
}))
