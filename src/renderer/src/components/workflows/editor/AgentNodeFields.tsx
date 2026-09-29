import React from 'react'
import type { AgentNode, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import AgentNodeArtifactsField from './AgentNodeArtifactsField'
import AgentNodeResultContractField from './AgentNodeResultContractField'
import AgentNodeWorkspaceField from './AgentNodeWorkspaceField'
import NodeRoleFields from './NodeRoleFields'

export type AgentNodeFieldsProps = {
  node: AgentNode
  roles: Workflow['roles']
  onChange: (node: AgentNode) => void
  allowlistedSources?: readonly string[]
  isFolderWorkspace?: boolean
}

/** Agent node settings: the shared role fields (`NodeRoleFields`) plus workspace policy, result
 *  contract and artifacts, which only Agent nodes have. */
export default function AgentNodeFields({
  node,
  roles,
  onChange,
  allowlistedSources,
  isFolderWorkspace
}: AgentNodeFieldsProps): React.JSX.Element {
  return (
    <>
      <NodeRoleFields
        node={node}
        roles={roles}
        onChange={onChange}
        allowlistedSources={allowlistedSources}
      />

      <AgentNodeWorkspaceField
        node={node}
        isFolderWorkspace={isFolderWorkspace}
        onChange={onChange}
      />

      <AgentNodeResultContractField node={node} onChange={onChange} />
      <AgentNodeArtifactsField node={node} onChange={onChange} />
    </>
  )
}
