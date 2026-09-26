import React, { useId } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { AgentNode, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { SettingsSegmentedControl } from '@/components/settings/SettingsFormControls'
import {
  agentLacksWorkspaceSkillSupport,
  isRoleFieldOverridden,
  revertRoleField,
  ROLE_OVERRIDABLE_FIELDS,
  type RoleOverridableField
} from '../roles/role-override-state'
import SkillReferenceList from '../roles/SkillReferenceList'
import AgentNodeArtifactsField from './AgentNodeArtifactsField'
import AgentNodeResultContractField from './AgentNodeResultContractField'
import { InspectorField } from './InspectorField'
import RoleDispatchFields from './RoleDispatchFields'
import { withRoleDispatchOverrides } from './workflow-role-dispatch-overrides'

export type AgentNodeFieldsProps = {
  node: AgentNode
  roles: Workflow['roles']
  onChange: (node: AgentNode) => void
  allowlistedSources?: readonly string[]
}

/** No role id is a valid empty string per `RolesSchema` (`min(1)`), so a distinct sentinel picks
 *  "no role" out of the Select without colliding with a real role id. */
const NO_ROLE = '__no_role__'

function roleFieldLabel(field: RoleOverridableField): string {
  switch (field) {
    case 'agent':
      return translate('auto.components.workflows.editor.AgentNodeFields.roleFieldAgent', 'Agent')
    case 'model':
      return translate('auto.components.workflows.editor.AgentNodeFields.roleFieldModel', 'Model')
    case 'effort':
      return translate(
        'auto.components.workflows.editor.AgentNodeFields.roleFieldEffort',
        'Reasoning effort'
      )
    case 'systemPrompt':
      return translate(
        'auto.components.workflows.editor.AgentNodeFields.roleFieldSystemPrompt',
        'System prompt'
      )
    case 'skills':
      return translate('auto.components.workflows.editor.AgentNodeFields.roleFieldSkills', 'Skills')
  }
}

/** Agent node settings: role assignment (FR-017) with role/model/effort/prompt via
 *  `RoleDispatchFields` (FR-003/FR-004), system prompt and skills overrides, a distinct
 *  "Role overrides" strip with one-click revert per overridden field (FR-017), a fallback
 *  warning for agents without workspace skill support (FR-020), plus workspace policy, result
 *  contract and artifacts, which only Agent nodes have. */
export default function AgentNodeFields({
  node,
  roles,
  onChange,
  allowlistedSources
}: AgentNodeFieldsProps): React.JSX.Element {
  const systemPromptId = useId()
  const role = node.roleId ? roles[node.roleId] : undefined
  const effectiveAgent = node.overrides?.agent ?? role?.agent
  const effectiveModel = node.overrides?.model ?? role?.model
  const effectiveEffort = node.overrides?.effort ?? role?.effort
  const effectiveSystemPrompt = node.overrides?.systemPrompt ?? role?.systemPrompt ?? ''
  const effectiveSkills = node.overrides?.skills ?? role?.skills ?? []

  const overriddenFields = role
    ? ROLE_OVERRIDABLE_FIELDS.filter((field) => isRoleFieldOverridden(node, field))
    : []
  const roleOptions = Object.values(roles).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <InspectorField
        label={translate('auto.components.workflows.editor.AgentNodeFields.roleLabel', 'Role')}
      >
        <Select
          value={node.roleId ?? NO_ROLE}
          onValueChange={(value) =>
            onChange({ ...node, roleId: value === NO_ROLE ? undefined : value })
          }
        >
          <SelectTrigger
            className="h-8 w-full"
            aria-label={translate(
              'auto.components.workflows.editor.AgentNodeFields.roleLabel',
              'Role'
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_ROLE}>
              {translate('auto.components.workflows.editor.AgentNodeFields.noRole', 'No role')}
            </SelectItem>
            {roleOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </InspectorField>

      {overriddenFields.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {translate(
              'auto.components.workflows.editor.AgentNodeFields.overridesHeading',
              'Role overrides'
            )}
          </span>
          {overriddenFields.map((field) => (
            <Badge key={field} variant="secondary">
              {roleFieldLabel(field)}
              <button
                type="button"
                onClick={() => onChange(revertRoleField(node, field))}
                aria-label={translate(
                  'auto.components.workflows.editor.AgentNodeFields.revertField',
                  'Revert {{field}} to role default',
                  { field: roleFieldLabel(field) }
                )}
                className="rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

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

      <InspectorField htmlFor={systemPromptId} label={roleFieldLabel('systemPrompt')}>
        <Textarea
          id={systemPromptId}
          value={effectiveSystemPrompt}
          onChange={(event) =>
            onChange(withRoleDispatchOverrides(node, { systemPrompt: event.target.value }))
          }
          className="min-h-20"
        />
      </InspectorField>

      <InspectorField label={roleFieldLabel('skills')}>
        <SkillReferenceList
          skills={effectiveSkills}
          onChange={(skills) => onChange(withRoleDispatchOverrides(node, { skills }))}
          allowlistedSources={allowlistedSources}
        />
      </InspectorField>

      {effectiveSkills.length > 0 && agentLacksWorkspaceSkillSupport(effectiveAgent) ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p>
            {translate(
              'auto.components.workflows.editor.AgentNodeFields.noWorkspaceSkillSupport',
              `"{{agent}}" can't load skills from a workspace; skill instructions will be included in the prompt instead.`,
              { agent: effectiveAgent }
            )}
          </p>
        </div>
      ) : null}

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
