import React from 'react'
import type {
  ReflectionNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { NodeRoleDispatchFields } from './RoleDispatchFields'

export type ReflectionNodeFieldsProps = {
  node: ReflectionNode
  roles: Workflow['roles']
  onChange: (node: ReflectionNode) => void
}

/** Reflection node settings (US7, FR-034, data-model.md §1 `roleDispatchFields`): the same
 *  role/model/effort/prompt fields Agent and Router nodes have. Its result contract is fixed to
 *  `{ proposals: [...] }` (contracts/agent-brief.md) rather than editable per node, so — unlike
 *  `AgentNodeFields` — there is no result-contract or artifacts field here. */
export default function ReflectionNodeFields({
  node,
  roles,
  onChange
}: ReflectionNodeFieldsProps): React.JSX.Element {
  const role = node.roleId ? roles[node.roleId] : undefined
  return <NodeRoleDispatchFields node={node} role={role} onChange={onChange} />
}
