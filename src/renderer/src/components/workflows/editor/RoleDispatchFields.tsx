import React, { useId } from 'react'
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
import { InspectorField } from './InspectorField'
import { getModelEffortAvailability } from './workflow-editor-commands'
import {
  agentSupportsModelCatalog,
  getAgentCatalogModels,
  getModelEffortChoices
} from './workflow-agent-model-catalog'

export type AgentModelEffortFieldsProps = {
  agent?: string
  model?: string
  effort?: string
  onAgentChange: (agent: string | undefined) => void
  onModelChange: (model: string) => void
  onEffortChange: (effort: string) => void
}

/** Agent/model/effort trio shared by every role-dispatching surface: per-node dispatch
 *  (`RoleDispatchFields`, below) and role definition editing (`roles/RoleEditor.tsx`). FR-004's
 *  disabled-with-reason rule for model/effort lives here once instead of per surface. */
export function AgentModelEffortFields({
  agent,
  model,
  effort,
  onAgentChange,
  onModelChange,
  onEffortChange
}: AgentModelEffortFieldsProps): React.JSX.Element {
  const agentCatalog = getAgentCatalog()
  // Why: AgentCombobox is typed over the known TuiAgent union; a custom/unknown agent id
  // (permitted by the node schema's plain string) shows as unselected rather than crashing.
  const selectedAgentEntry = agentCatalog.find((entry) => entry.id === agent)

  const modelAvailability = getModelEffortAvailability(agent, {
    agentSupportsModel: agentSupportsModelCatalog
  })
  const models = agent ? getAgentCatalogModels(agent) : []
  const effortChoices = agent ? getModelEffortChoices(agent, model) : []
  const effortReason = !modelAvailability.enabled
    ? modelAvailability.reason
    : model === undefined
      ? translate(
          'auto.components.workflows.editor.RoleDispatchFields.selectModelForEffort',
          'Select a model before choosing reasoning effort.'
        )
      : effortChoices.length === 0
        ? translate(
            'auto.components.workflows.editor.RoleDispatchFields.noEffortLevels',
            '"{{model}}" has no reasoning effort levels.',
            { model }
          )
        : undefined

  return (
    <>
      <InspectorField
        label={translate('auto.components.workflows.editor.RoleDispatchFields.agentLabel', 'Agent')}
      >
        <AgentCombobox
          agents={agentCatalog}
          value={selectedAgentEntry?.id ?? null}
          onValueChange={(next) => onAgentChange(next ?? undefined)}
          allowBlankTerminal={false}
          emptyLabel={translate(
            'auto.components.workflows.editor.RoleDispatchFields.selectAgent',
            'Select agent'
          )}
        />
      </InspectorField>

      <InspectorField
        label={translate('auto.components.workflows.editor.RoleDispatchFields.modelLabel', 'Model')}
      >
        <Select
          value={model ?? ''}
          onValueChange={onModelChange}
          disabled={!modelAvailability.enabled}
        >
          <SelectTrigger
            className="h-8 w-full"
            aria-label={translate(
              'auto.components.workflows.editor.RoleDispatchFields.modelLabel',
              'Model'
            )}
          >
            <SelectValue
              placeholder={translate(
                'auto.components.workflows.editor.RoleDispatchFields.selectModel',
                'Select a model'
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {models.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
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
          'auto.components.workflows.editor.RoleDispatchFields.effortLabel',
          'Reasoning effort'
        )}
      >
        <Select
          value={effort ?? ''}
          onValueChange={onEffortChange}
          disabled={effortReason !== undefined}
        >
          <SelectTrigger
            className="h-8 w-full"
            aria-label={translate(
              'auto.components.workflows.editor.RoleDispatchFields.effortLabel',
              'Reasoning effort'
            )}
          >
            <SelectValue
              placeholder={translate(
                'auto.components.workflows.editor.RoleDispatchFields.selectEffort',
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
    </>
  )
}

export type RoleDispatchFieldsProps = {
  agent?: string
  model?: string
  effort?: string
  prompt: string
  onAgentChange: (agent: string | undefined) => void
  onModelChange: (model: string) => void
  onEffortChange: (effort: string) => void
  onPromptChange: (prompt: string) => void
}

/** Agent/model/effort/prompt fields shared by every role-dispatching node (data-model.md §1's
 *  `roleDispatchShape`: AgentNode, RouterNode, later Reflection). FR-004's disabled-with-reason
 *  rule for model/effort lives in `AgentModelEffortFields` once instead of per node type. */
export default function RoleDispatchFields({
  agent,
  model,
  effort,
  prompt,
  onAgentChange,
  onModelChange,
  onEffortChange,
  onPromptChange
}: RoleDispatchFieldsProps): React.JSX.Element {
  const promptId = useId()

  return (
    <>
      <AgentModelEffortFields
        agent={agent}
        model={model}
        effort={effort}
        onAgentChange={onAgentChange}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
      />

      <InspectorField
        htmlFor={promptId}
        label={translate(
          'auto.components.workflows.editor.RoleDispatchFields.promptLabel',
          'Prompt'
        )}
      >
        <Textarea
          id={promptId}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          className="min-h-24"
        />
      </InspectorField>
    </>
  )
}
