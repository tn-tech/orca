import React, { useId, useState } from 'react'
import { SettingsSegmentedControl } from '@/components/settings/SettingsFormControls'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { DEFAULT_WORKFLOW_CONCURRENCY_LIMIT } from '../../../../../shared/workflows/workflow-concurrency-default'
import { effectiveWorkspacePolicy } from '../../../../../shared/workflows/workflow-workspace-policy'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { InspectorField } from './InspectorField'
import type { WorkflowSettingsPatch } from './workflow-settings-command'

export type WorkflowSettingsPanelProps = {
  definition: Workflow
  /** FR-041: folder workspaces have no worktrees, so child workspaces are unavailable. */
  isFolderWorkspace?: boolean
  onChange: (patch: WorkflowSettingsPatch) => void
}

type ParsedLimit = { ok: true; value: number | undefined } | { ok: false }

/** Blank means "use the default"; otherwise a positive integer, matching the file schema. */
function parseConcurrencyLimit(text: string): ParsedLimit {
  const trimmed = text.trim()
  if (trimmed === '') {
    return { ok: true, value: undefined }
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false }
  }
  const value = Number.parseInt(trimmed, 10)
  return value >= 1 && Number.isSafeInteger(value) ? { ok: true, value } : { ok: false }
}

/** Workflow-level settings (US3 AS1): workspace policy and default concurrency limit. Shown by
 *  `NodeInspector` above the Roles panel when nothing is selected. */
export default function WorkflowSettingsPanel({
  definition,
  isFolderWorkspace = false,
  onChange
}: WorkflowSettingsPanelProps): React.JSX.Element {
  const limitId = useId()
  const limitErrorId = useId()
  const committedLimit = definition.concurrencyLimit
  const [limitDraft, setLimitDraft] = useState(() => String(committedLimit ?? ''))
  const [syncedLimit, setSyncedLimit] = useState(committedLimit)
  // Resync on external changes (undo, reload) but never fight mid-edit invalid text.
  if (committedLimit !== syncedLimit) {
    setSyncedLimit(committedLimit)
    setLimitDraft(String(committedLimit ?? ''))
  }
  const parsedLimit = parseConcurrencyLimit(limitDraft)

  // FR-041: the engine forces in-place for folder workspaces whatever the file saved.
  const policy = effectiveWorkspacePolicy(
    { kind: isFolderWorkspace ? 'folder' : 'git' },
    definition.workspacePolicy
  )
  const inPlace = policy === 'in-place'
  const childNodeCount = inPlace
    ? definition.nodes.filter((node) => node.type === 'agent' && node.workspace === 'child').length
    : 0

  function handleLimitInput(text: string): void {
    setLimitDraft(text)
    const parsed = parseConcurrencyLimit(text)
    if (parsed.ok) {
      onChange({ concurrencyLimit: parsed.value })
    }
  }

  const policyLabel = translate(
    'auto.components.workflows.editor.WorkflowSettingsPanel.policyLabel',
    'Workspace policy'
  )

  return (
    <section className="flex flex-col gap-4 border-b border-border p-4">
      <h2 className="text-sm font-semibold">
        {translate('auto.components.workflows.editor.WorkflowSettingsPanel.heading', 'Settings')}
      </h2>
      <InspectorField label={policyLabel}>
        <SettingsSegmentedControl<Workflow['workspacePolicy']>
          value={policy}
          onChange={(workspacePolicy) => onChange({ workspacePolicy })}
          ariaLabel={policyLabel}
          options={[
            {
              value: 'run-workspace',
              disabled: isFolderWorkspace,
              label: translate(
                'auto.components.workflows.editor.WorkflowSettingsPanel.policyRun',
                'Run workspace'
              )
            },
            {
              value: 'in-place',
              disabled: isFolderWorkspace,
              label: translate(
                'auto.components.workflows.editor.WorkflowSettingsPanel.policyInPlace',
                'In place'
              )
            }
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {inPlace
            ? translate(
                'auto.components.workflows.editor.WorkflowSettingsPanel.policyInPlaceHelp',
                'Agents work directly in the project folder. Child workspaces are unavailable.'
              )
            : translate(
                'auto.components.workflows.editor.WorkflowSettingsPanel.policyRunHelp',
                'Each run gets its own workspace, so the project folder stays untouched.'
              )}
        </p>
        {isFolderWorkspace ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.workflows.editor.WorkflowSettingsPanel.folderNote',
              'This project is a folder without version control, so runs always happen in place and child workspaces are unavailable.'
            )}
          </p>
        ) : null}
        {childNodeCount > 0 ? (
          <p role="status" className="text-xs text-destructive">
            {translate(
              'auto.components.workflows.editor.WorkflowSettingsPanel.childNodesWarning',
              '{{count}} agent node(s) request a child workspace, which in-place workflows disallow. Switch them to the run workspace.',
              { count: childNodeCount }
            )}
          </p>
        ) : null}
      </InspectorField>
      <InspectorField
        htmlFor={limitId}
        label={translate(
          'auto.components.workflows.editor.WorkflowSettingsPanel.concurrencyLabel',
          'Concurrency limit'
        )}
      >
        <Input
          id={limitId}
          // Text, not number: a number input reports "" for text like "-", which would clear the limit mid-typing.
          type="text"
          inputMode="numeric"
          value={limitDraft}
          placeholder={String(DEFAULT_WORKFLOW_CONCURRENCY_LIMIT)}
          onChange={(event) => handleLimitInput(event.target.value)}
          onBlur={() => {
            // Never leave text on screen that the file doesn't hold.
            if (!parsedLimit.ok) {
              setLimitDraft(String(committedLimit ?? ''))
            }
          }}
          aria-invalid={!parsedLimit.ok}
          aria-describedby={parsedLimit.ok ? undefined : limitErrorId}
          className="h-8 w-24"
        />
        {parsedLimit.ok ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.workflows.editor.WorkflowSettingsPanel.concurrencyHelp',
              'Most agents that run at once. Leave blank for the default ({{default}}).',
              { default: DEFAULT_WORKFLOW_CONCURRENCY_LIMIT }
            )}
          </p>
        ) : (
          <p id={limitErrorId} className="text-xs text-destructive">
            {translate(
              'auto.components.workflows.editor.WorkflowSettingsPanel.concurrencyInvalid',
              'Enter a whole number of at least 1.'
            )}
          </p>
        )}
      </InspectorField>
    </section>
  )
}
