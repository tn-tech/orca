import React from 'react'
import { translate } from '@/i18n/i18n'

// Why: placeholder shell mirroring AutomationsPage's header/main structure (U13); the DAG
// canvas, run list, and detail panes land in later workflow units.
export default function WorkflowsPage(): React.JSX.Element {
  return (
    <main className="relative flex h-full min-h-0 flex-col bg-background pt-5 text-foreground md:pt-6">
      <header
        className="flex shrink-0 items-center px-3 pb-3 md:px-5"
        style={{ paddingRight: 'max(0.75rem, var(--window-controls-width, 0px))' }}
      >
        <h1 className="truncate text-base font-semibold leading-8">
          {translate('auto.components.workflows.WorkflowsPage.title', 'Workflows')}
        </h1>
      </header>
      <div className="flex flex-1 min-h-0 items-center justify-center text-sm text-muted-foreground">
        {translate(
          'auto.components.workflows.WorkflowsPage.placeholder',
          'The workflow canvas is coming soon.'
        )}
      </div>
    </main>
  )
}
