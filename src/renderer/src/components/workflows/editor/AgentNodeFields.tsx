import React from 'react'
import type { AgentNode, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { SettingsSegmentedControl } from '@/components/settings/SettingsFormControls'
import { translate } from '@/i18n/i18n'
import AgentNodeArtifactsField from './AgentNodeArtifactsField'
import AgentNodeResultContractField from './AgentNodeResultContractField'
import { InspectorField } from './InspectorField'
import NodeRoleFields from './NodeRoleFields'

export type AgentNodeFieldsProps = {
  node: AgentNode
  roles: Workflow['roles']
  onChange: (node: AgentNode) => void
  allowlistedSources?: readonly string[]
}

/** Agent node settings: the shared role fields (`NodeRoleFields`) plus workspace policy, result
 *  contract and artifacts, which only Agent nodes have. */
export default function AgentNodeFields({
  node,
  roles,
  onChange,
  allowlistedSources
}: AgentNodeFieldsProps): React.JSX.Element {
  return (
    <>
      <NodeRoleFields
        node={node}
        roles={roles}
        onChange={onChange}
        allowlistedSources={allowlistedSources}
      />

      <InspectorField
        label={translate(
          'auto.components.workflows.editor.AgentNodeFields.workspaceLabel',
          'Workspace'
        )}
      >
        <SettingsSegmentedControl<AgentNode['workspace']>
          value={node.workspace}
          onChange={(value) => onChange({ ...node, workspace: value })}
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
              )
            }
          ]}
          ariaLabel={translate(
            'auto.components.workflows.editor.AgentNodeFields.workspaceLabel',
            'Workspace'
          )}
        />
      </InspectorField>

      <AgentNodeResultContractField node={node} onChange={onChange} />
      <AgentNodeArtifactsField node={node} onChange={onChange} />
    </>
  )
}
