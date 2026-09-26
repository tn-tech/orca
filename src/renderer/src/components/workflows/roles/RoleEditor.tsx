import React, { useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { AgentModelEffortFields } from '../editor/RoleDispatchFields'
import type {
  Role,
  SkillSource,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import type { RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'
import ImportRoleDialog from './ImportRoleDialog'
import SkillReferenceList from './SkillReferenceList'
import TrustSourceDialog from './TrustSourceDialog'

export type RoleEditorProps = {
  role: Role
  onChange: (role: Role) => void
  /** Every role in the workflow (this one included), used to compute the agents a skill
   *  source's trust decision would actually affect. Omit for a standalone role (falls back to
   *  just this role's own agent). */
  roles?: Workflow['roles']
  allowlistedSources?: readonly string[]
  /** Import/re-import (FR-016) needs somewhere to send the RPC; omit to hide that action. */
  repo?: string
  settings?: RuntimeWorkflowSettings
}

function sourceKey(source: SkillSource): string {
  return source.kind === 'plugin' ? `plugin:${source.plugin}` : `repository:${source.location}`
}

function sourceIdentifier(source: SkillSource): string {
  return source.kind === 'plugin' ? source.plugin : source.location
}

/** Skill names and agents a trust decision for `source` would affect, scoped to `roles` when the
 *  caller has the whole workflow, or just `role` on its own otherwise (FR-018a). */
function trustScopeFor(
  role: Role,
  roles: Workflow['roles'] | undefined,
  source: SkillSource
): { skills: string[]; agents: string[] } {
  const candidates = roles ? Object.values(roles) : [role]
  const key = sourceKey(source)
  const skills = candidates
    .flatMap((candidate) => candidate.skills)
    .filter((skill) => sourceKey(skill.source) === key)
    .map((skill) => skill.name)
  const agents = [
    ...new Set(
      candidates
        .filter((candidate) => candidate.skills.some((skill) => sourceKey(skill.source) === key))
        .map((candidate) => candidate.agent)
    )
  ]
  return { skills, agents: agents.length > 0 ? agents : [role.agent] }
}

/** Edits a role definition (data-model.md §1 `Role`): agent/model/effort/system prompt, skills,
 *  and import-from-repository (FR-015, FR-016). A node's own override of these fields is
 *  `editor/AgentNodeFields.tsx`'s concern, not this component's. */
export default function RoleEditor({
  role,
  onChange,
  roles,
  allowlistedSources,
  repo,
  settings
}: RoleEditorProps): React.JSX.Element {
  const nameId = useId()
  const systemPromptId = useId()
  const [importOpen, setImportOpen] = useState(false)
  const [trustSource, setTrustSource] = useState<SkillSource | undefined>()

  const trustScope = trustSource ? trustScopeFor(role, roles, trustSource) : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor={nameId}>
          {translate('auto.components.workflows.roles.RoleEditor.nameLabel', 'Name')}
        </Label>
        <Input
          id={nameId}
          value={role.name}
          onChange={(event) => onChange({ ...role, name: event.target.value })}
          className="h-8"
        />
      </div>

      <AgentModelEffortFields
        agent={role.agent}
        model={role.model}
        effort={role.effort}
        onAgentChange={(agent) =>
          agent ? onChange({ ...role, agent, model: undefined, effort: undefined }) : undefined
        }
        onModelChange={(model) => onChange({ ...role, model, effort: undefined })}
        onEffortChange={(effort) => onChange({ ...role, effort })}
      />

      <div className="space-y-1.5">
        <Label htmlFor={systemPromptId}>
          {translate(
            'auto.components.workflows.roles.RoleEditor.systemPromptLabel',
            'System prompt'
          )}
        </Label>
        <Textarea
          id={systemPromptId}
          value={role.systemPrompt}
          onChange={(event) => onChange({ ...role, systemPrompt: event.target.value })}
          className="min-h-24"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label>
            {translate('auto.components.workflows.roles.RoleEditor.skillsLabel', 'Skills')}
          </Label>
          {repo && settings ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              {translate(
                'auto.components.workflows.roles.RoleEditor.importFromRepository',
                'Import from repository…'
              )}
            </Button>
          ) : null}
        </div>
        <SkillReferenceList
          skills={role.skills}
          onChange={(skills) => onChange({ ...role, skills })}
          allowlistedSources={allowlistedSources}
          onRequestTrust={setTrustSource}
        />
      </div>

      {role.origin ? (
        <div className="space-y-1 rounded-md border border-border p-2 text-xs text-muted-foreground">
          <p>
            {translate(
              'auto.components.workflows.roles.RoleEditor.originSummary',
              'Imported from {{source}} @ {{version}} on {{importedAt}}.',
              {
                source: role.origin.source,
                version: role.origin.version,
                importedAt: role.origin.importedAt
              }
            )}
          </p>
          {role.origin.localModified ? (
            <Badge variant="secondary">
              {translate(
                'auto.components.workflows.roles.RoleEditor.locallyModified',
                'Locally modified'
              )}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {repo && settings ? (
        <ImportRoleDialog
          key={importOpen ? 'open' : 'closed'}
          open={importOpen}
          repo={repo}
          settings={settings}
          initialSource={role.origin?.source}
          initialRoleName={role.name}
          onOpenChange={setImportOpen}
          onImported={(imported) => onChange({ ...imported, id: role.id })}
        />
      ) : null}

      {trustSource && trustScope ? (
        <TrustSourceDialog
          key={sourceIdentifier(trustSource)}
          open
          settings={settings}
          source={sourceIdentifier(trustSource)}
          skills={trustScope.skills}
          agents={trustScope.agents}
          onOpenChange={(open) => {
            if (!open) {
              setTrustSource(undefined)
            }
          }}
        />
      ) : null}
    </div>
  )
}
