import React from 'react'
import type {
  ReflectionNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import RoleDispatchFields from './RoleDispatchFields'
import { withRoleDispatchOverrides } from './workflow-role-dispatch-overrides'

export type ReflectionNodeFieldsProps = {
  node: ReflectionNode
  roles: Workflow['roles']
  onChange: (node: ReflectionNode) => void
}

/** Reflection node settings (US7, FR-034, data-model.md §1 `roleDispatchShape`): the same
 *  role/model/effort/prompt fields Agent and Router nodes have. Its result contract is fixed to
 *  `{ proposals: [...] }` (contracts/agent-brief.md) rather than editable per node, so — unlike
 *  `AgentNodeFields` — there is no result-contract or artifacts field here. */
export default function ReflectionNodeFields({
  node,
  roles,
  onChange
}: ReflectionNodeFieldsProps): React.JSX.Element {
  const role = node.roleId ? roles[node.roleId] : undefined
  const effectiveAgent = node.overrides?.agent ?? role?.agent
  const effectiveModel = node.overrides?.model ?? role?.model
  const effectiveEffort = node.overrides?.effort ?? role?.effort

  return (
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
  )
}
