import React from 'react'
import type {
  ReflectionNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import NodeRoleFields from './NodeRoleFields'

export type ReflectionNodeFieldsProps = {
  node: ReflectionNode
  roles: Workflow['roles']
  onChange: (node: ReflectionNode) => void
  allowlistedSources?: readonly string[]
}

/** Reflection node settings (US7, FR-034, data-model.md §1 `roleDispatchFields`): the same
 *  role/model/effort/prompt fields Agent and Router nodes have. Its result contract is fixed to
 *  `{ proposals: [...] }` (contracts/agent-brief.md) rather than editable per node, so — unlike
 *  `AgentNodeFields` — there is no result-contract or artifacts field here. */
export default function ReflectionNodeFields({
  node,
  roles,
  onChange,
  allowlistedSources
}: ReflectionNodeFieldsProps): React.JSX.Element {
  return (
    <NodeRoleFields
      node={node}
      roles={roles}
      onChange={onChange}
      allowlistedSources={allowlistedSources}
    />
  )
}
