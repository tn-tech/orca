import React from 'react'
import { SettingsSegmentedControl } from '@/components/settings/SettingsFormControls'
import { translate } from '@/i18n/i18n'
import type { AgentNode } from '../../../../../shared/workflows/workflow-definition-types'
import { InspectorField } from './InspectorField'

export type AgentNodeWorkspaceFieldProps = {
  node: AgentNode
  /** FR-041: folder workspaces have no worktrees, so a child workspace can't be provisioned. */
  isFolderWorkspace?: boolean
  onChange: (node: AgentNode) => void
}

/** Where an Agent node runs: the run workspace, or a child workspace of its own. */
export default function AgentNodeWorkspaceField({
  node,
  isFolderWorkspace = false,
  onChange
}: AgentNodeWorkspaceFieldProps): React.JSX.Element {
  const label = translate(
    'auto.components.workflows.editor.AgentNodeFields.workspaceLabel',
    'Workspace'
  )
  return (
    <InspectorField label={label}>
      <SettingsSegmentedControl<AgentNode['workspace']>
        value={node.workspace}
        onChange={(value) => onChange({ ...node, workspace: value })}
        ariaLabel={label}
        options={[
          {
            value: 'run',
            label: translate(
              'auto.components.workflows.editor.AgentNodeFields.workspaceRun',
              'Run workspace'
            )
          },
          {
            value: 'child',
            label: translate(
              'auto.components.workflows.editor.AgentNodeFields.workspaceChild',
              'Child workspace'
            ),
            disabled: isFolderWorkspace,
            ...(isFolderWorkspace ? { tooltip: folderReason() } : {})
          }
        ]}
      />
      {isFolderWorkspace ? <p className="text-xs text-muted-foreground">{folderReason()}</p> : null}
    </InspectorField>
  )
}

function folderReason(): string {
  return translate(
    'auto.components.workflows.editor.AgentNodeWorkspaceField.folderReason',
    'Folder workspaces have no worktrees, so child workspaces are unavailable.'
  )
}
