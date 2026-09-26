import {
  catalogSupportsWorkerLaunchPreferences,
  findCatalogModel,
  findCatalogOption,
  getAgentSessionOptionCatalog,
  type CatalogModel
} from '../../../../../shared/agent-session-option-catalog'

/** Same predicate `workflow-node-dispatch.ts` uses on the host, so editor and engine agree on
 *  which agents accept a launch-time model/effort choice (FR-004). */
export function agentSupportsModelCatalog(agent: string): boolean {
  return catalogSupportsWorkerLaunchPreferences(getAgentSessionOptionCatalog(agent))
}

/** Models offered for `agent`; empty when the agent has no launch-preference catalog. */
export function getAgentCatalogModels(agent: string): CatalogModel[] {
  if (!agentSupportsModelCatalog(agent)) {
    return []
  }
  return getAgentSessionOptionCatalog(agent)?.models ?? []
}

/** Effort choices for `modelId`, from that model's 'effort' catalog option (not every model has one). */
export function getModelEffortChoices(
  agent: string,
  modelId: string | undefined
): { value: string; label: string }[] {
  const catalog = getAgentSessionOptionCatalog(agent)
  if (!catalog || modelId === undefined) {
    return []
  }
  const model = findCatalogModel(catalog, modelId)
  const effortOption = findCatalogOption(model, 'effort')
  return effortOption?.kind.type === 'select' ? effortOption.kind.choices : []
}
