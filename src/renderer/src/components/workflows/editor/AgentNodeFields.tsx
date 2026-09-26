import React from 'react'
import AgentCombobox from '@/components/agent/AgentCombobox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import type { AgentNode, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { SettingsSegmentedControl } from '@/components/settings/SettingsFormControls'
import AgentNodeArtifactsField from './AgentNodeArtifactsField'
import AgentNodeResultContractField from './AgentNodeResultContractField'
import { InspectorField } from './InspectorField'
import { getModelEffortAvailability } from './workflow-editor-commands'
import {
  agentSupportsModelCatalog,
  getAgentCatalogModels,
  getModelEffortChoices
} from './workflow-agent-model-catalog'

export type AgentNodeFieldsProps = {
  node: AgentNode
  roles: Workflow['roles']
  onChange: (node: AgentNode) => void
}

type AgentOverrides = NonNullable<AgentNode['overrides']>

const OVERRIDE_KEYS: readonly (keyof AgentOverrides)[] = [
  'agent',
  'model',
  'effort',
  'systemPrompt',
  'skills'
]

function withOverrides(node: AgentNode, patch: Partial<AgentOverrides>): AgentNode {
  const merged: AgentOverrides = { ...node.overrides, ...patch }
  for (const key of OVERRIDE_KEYS) {
    if (merged[key] === undefined) {
      delete merged[key]
    }
  }
  return { ...node, overrides: Object.keys(merged).length > 0 ? merged : undefined }
}

/** Agent node settings: agent/model/effort, prompt, workspace policy, result contract and
 *  artifacts (FR-003). Model/effort are disabled with a reason when the agent has no launch
 *  catalog or the chosen model has no effort levels (FR-004, US1 AS5). */
export default function AgentNodeFields({
  node,
  roles,
  onChange
}: AgentNodeFieldsProps): React.JSX.Element {
  const role = node.roleId ? roles[node.roleId] : undefined
  const effectiveAgent = node.overrides?.agent ?? role?.agent
  const effectiveModel = node.overrides?.model ?? role?.model
  const effectiveEffort = node.overrides?.effort ?? role?.effort
  const agentCatalog = getAgentCatalog()
  // Why: AgentCombobox is typed over the known TuiAgent union; a custom/unknown agent id
  // (permitted by the node schema's plain string) shows as unselected rather than crashing.
  const selectedAgentEntry = agentCatalog.find((entry) => entry.id === effectiveAgent)

  const modelAvailability = getModelEffortAvailability(effectiveAgent, {
    agentSupportsModel: agentSupportsModelCatalog
  })
  const models = effectiveAgent ? getAgentCatalogModels(effectiveAgent) : []
  const effortChoices = effectiveAgent ? getModelEffortChoices(effectiveAgent, effectiveModel) : []
  const effortReason = !modelAvailability.enabled
    ? modelAvailability.reason
    : effectiveModel === undefined
      ? translate(
          'auto.components.workflows.editor.AgentNodeFields.selectModelForEffort',
          'Select a model before choosing reasoning effort.'
        )
      : effortChoices.length === 0
        ? translate(
            'auto.components.workflows.editor.AgentNodeFields.noEffortLevels',
            '"{{model}}" has no reasoning effort levels.',
            { model: effectiveModel }
          )
        : undefined

  return (
    <>
      <InspectorField
        label={translate('auto.components.workflows.editor.AgentNodeFields.agentLabel', 'Agent')}
      >
        <AgentCombobox
          agents={agentCatalog}
          value={selectedAgentEntry?.id ?? null}
          onValueChange={(agent) =>
            onChange(
              withOverrides(node, {
                agent: agent ?? undefined,
                model: undefined,
                effort: undefined
              })
            )
          }
          allowBlankTerminal={false}
          emptyLabel={translate(
            'auto.components.workflows.editor.AgentNodeFields.selectAgent',
            'Select agent'
          )}
        />
      </InspectorField>

      <InspectorField
        label={translate('auto.components.workflows.editor.AgentNodeFields.modelLabel', 'Model')}
      >
        <Select
          value={effectiveModel ?? ''}
          onValueChange={(value) =>
            onChange(withOverrides(node, { model: value, effort: undefined }))
          }
          disabled={!modelAvailability.enabled}
        >
          <SelectTrigger
            className="h-8 w-full"
            aria-label={translate(
              'auto.components.workflows.editor.AgentNodeFields.modelLabel',
              'Model'
            )}
          >
            <SelectValue
              placeholder={translate(
                'auto.components.workflows.editor.AgentNodeFields.selectModel',
                'Select a model'
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!modelAvailability.enabled ? (
          <p className="text-xs text-muted-foreground">{modelAvailability.reason}</p>
        ) : null}
      </InspectorField>

      <InspectorField
        label={translate(
          'auto.components.workflows.editor.AgentNodeFields.effortLabel',
          'Reasoning effort'
        )}
      >
        <Select
          value={effectiveEffort ?? ''}
          onValueChange={(value) => onChange(withOverrides(node, { effort: value }))}
          disabled={effortReason !== undefined}
        >
          <SelectTrigger
            className="h-8 w-full"
            aria-label={translate(
              'auto.components.workflows.editor.AgentNodeFields.effortLabel',
              'Reasoning effort'
            )}
          >
            <SelectValue
              placeholder={translate(
                'auto.components.workflows.editor.AgentNodeFields.selectEffort',
                'Select reasoning effort'
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {effortChoices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {effortReason ? <p className="text-xs text-muted-foreground">{effortReason}</p> : null}
      </InspectorField>

      <InspectorField
        label={translate('auto.components.workflows.editor.AgentNodeFields.promptLabel', 'Prompt')}
      >
        <Textarea
          value={node.prompt}
          onChange={(event) => onChange({ ...node, prompt: event.target.value })}
          className="min-h-24"
        />
      </InspectorField>

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
