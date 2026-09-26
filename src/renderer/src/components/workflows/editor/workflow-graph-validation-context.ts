import { getAgentCatalog } from '@/lib/agent-catalog'
import type { GraphValidationContext } from '../../../../../shared/workflows/workflow-graph-validation'
import { agentSupportsModelCatalog } from './workflow-agent-model-catalog'

/**
 * Renderer-only validation context for instant feedback while editing (FR-009). It has no view of
 * the project's skill-source allowlist — that's host state — so `allowlistedSources` stays empty;
 * `workflow-validation-merge.ts` drops the one check that would need it before merging with the
 * host's `workflow.validate` result.
 */
export function createLocalGraphValidationContext(): GraphValidationContext {
  const knownAgentIds = new Set<string>(getAgentCatalog().map((agent) => agent.id))
  return {
    agentSupportsModel: agentSupportsModelCatalog,
    isKnownAgent: (agent) => knownAgentIds.has(agent),
    allowlistedSources: []
  }
}
