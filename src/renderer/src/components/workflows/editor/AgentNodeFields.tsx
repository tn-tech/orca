import React from 'react'
import { translate } from '@/i18n/i18n'
import type { AgentNode, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { SettingsSegmentedControl } from '@/components/settings/SettingsFormControls'
import AgentNodeArtifactsField from './AgentNodeArtifactsField'
import AgentNodeResultContractField from './AgentNodeResultContractField'
import { InspectorField } from './InspectorField'
import RoleDispatchFields from './RoleDispatchFields'
import { withRoleDispatchOverrides } from './workflow-role-dispatch-overrides'

export type AgentNodeFieldsProps = {
  node: AgentNode
  roles: Workflow['roles']
  onChange: (node: AgentNode) => void
}

/** Agent node settings: agent/model/effort/prompt via `RoleDispatchFields` (FR-003/FR-004),
 *  plus workspace policy, result contract and artifacts, which only Agent nodes have. */
export default function AgentNodeFields({
  node,
  roles,
  onChange
}: AgentNodeFieldsProps): React.JSX.Element {
  const role = node.roleId ? roles[node.roleId] : undefined
  const effectiveAgent = node.overrides?.agent ?? role?.agent
  const effectiveModel = node.overrides?.model ?? role?.model
  const effectiveEffort = node.overrides?.effort ?? role?.effort

  return (
    <>
      <RoleDispatchFields
        agent={effectiveAgent}
        model={effectiveModel}
        effort={effectiveEffort}
        prompt={node.prompt}
        onAgentChange={(agent) =>
          onChange(withRoleDispatchOverrides(node, { agent, model: undefined, effort: undefined }))
        }
        onModelChange={(model) =>
          onChange(withRoleDispatchOverrides(node, { model, effort: undefined }))
        }
        onEffortChange={(effort) => onChange(withRoleDispatchOverrides(node, { effort }))}
        onPromptChange={(prompt) => onChange({ ...node, prompt })}
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
