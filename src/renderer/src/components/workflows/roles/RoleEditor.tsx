import React, { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import type { WorkflowRunSource } from '../../../../../shared/workflows/workflow-run-types'
import {
  workflowImportRole,
  type RuntimeWorkflowSettings,
  type WorkflowImportRoleResult
} from '@/runtime/runtime-workflow-client'
import ImportRoleDialog from './ImportRoleDialog'
import SkillReferenceList from './SkillReferenceList'
import TrustSourceDialog from './TrustSourceDialog'

/** The saved workflow this role's file lives in, needed to re-import (FR-016): the engine's
 *  hash check runs against what's actually on disk, so a re-import write only makes sense once
 *  the draft is clean and `revision` names the saved copy the check should target. */
export type RoleEditorWorkflowContext = {
  name: string
  source?: WorkflowRunSource
  revision: string | null
  dirty: boolean
}

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
  /** The open repo's trust host (FR-018a: `local`, `ssh:<id>`, `wsl:<distro>`) — where the Trust
   *  dialog's decision actually lands. Omit defaults to `local`. */
  host?: string
  settings?: RuntimeWorkflowSettings
  /** Enables re-import; omit to hide that action (a role with no saved-workflow context yet). */
  workflow?: RoleEditorWorkflowContext
  /** Called after a re-import (or an overwrite) writes to disk, so the caller can reload the
   *  draft and its revision from what the engine actually saved. */
  onReloadFromDisk?: () => void | Promise<void>
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

/** Why not shown when `workflow` is absent: there's nothing to target a write at, so the action
 *  would be a dead end rather than a disabled-with-reason control. */
function reimportDisabledReason(workflow: RoleEditorWorkflowContext): string | undefined {
  if (workflow.dirty) {
    return translate(
      'auto.components.workflows.roles.RoleEditor.reimportNeedsSave',
      'Save your changes before re-importing — the check runs against the saved file.'
    )
  }
  if (workflow.revision === null) {
    return translate(
      'auto.components.workflows.roles.RoleEditor.reimportNeedsFirstSave',
      'Save the workflow at least once before re-importing.'
    )
  }
  return undefined
}

/** Edits a role definition (data-model.md §1 `Role`): agent/model/effort/system prompt, skills,
 *  import-from-repository for a role not yet imported, and re-import/overwrite for one that is
 *  (FR-015, FR-016). A node's own override of these fields is `editor/AgentNodeFields.tsx`'s
 *  concern, not this component's. */
export default function RoleEditor({
  role,
  onChange,
  roles,
  allowlistedSources,
  repo,
  host,
  settings,
  workflow,
  onReloadFromDisk
}: RoleEditorProps): React.JSX.Element {
  const nameId = useId()
  const systemPromptId = useId()
  const [importOpen, setImportOpen] = useState(false)
  const [reimportOpen, setReimportOpen] = useState(false)
  const [pendingUpstreamVersion, setPendingUpstreamVersion] = useState<string | undefined>()
  const [overwriteSubmitting, setOverwriteSubmitting] = useState(false)
  const [overwriteError, setOverwriteError] = useState<string | undefined>()
  const [trustSource, setTrustSource] = useState<SkillSource | undefined>()

  const trustScope = trustSource ? trustScopeFor(role, roles, trustSource) : undefined
  const canImport = repo !== undefined && settings !== undefined
  const disabledReason = workflow ? reimportDisabledReason(workflow) : undefined
  const canReimport = canImport && workflow !== undefined && disabledReason === undefined

  function handleNewImport(result: WorkflowImportRoleResult): void {
    onChange({ ...result.role, id: role.id })
  }

  // Why not `else`: the engine always writes and returns `revision` once `workflow` is given —
  // `availableVersion` rides *alongside* it, not instead of it, when a locally modified copy was
  // kept (workflow-role-import-method.ts's `mergeResult`). Checking `revision` first and
  // returning would skip the kept-local notice on every real re-import that has one.
  async function handleReimportResult(result: WorkflowImportRoleResult): Promise<void> {
    if (result.revision !== undefined) {
      await onReloadFromDisk?.()
    }
    setPendingUpstreamVersion(result.availableVersion)
  }

  async function handleOverwrite(): Promise<void> {
    if (
      !repo ||
      !settings ||
      !workflow ||
      workflow.dirty ||
      !role.origin ||
      pendingUpstreamVersion === undefined
    ) {
      return
    }
    setOverwriteSubmitting(true)
    setOverwriteError(undefined)
    try {
      const result = await workflowImportRole(settings, {
        repo,
        source: role.origin.source,
        roleName: role.id,
        // Why: pins to the exact commit the kept-local notice named, not the repository's
        // current default branch, which may have moved again since that notice was shown.
        version: pendingUpstreamVersion,
        workflow: workflow.name,
        workflowSource: workflow.source,
        expectedRevision: workflow.revision ?? undefined,
        overwriteLocal: true
      })
      if (result.revision !== undefined) {
        await onReloadFromDisk?.()
      }
      setPendingUpstreamVersion(result.availableVersion)
    } catch (err) {
      setOverwriteError(err instanceof Error ? err.message : String(err))
    } finally {
      setOverwriteSubmitting(false)
    }
  }

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
          {!role.origin && canImport ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              {translate(
                'auto.components.workflows.roles.RoleEditor.importFromRepository',
                'Import from repository…'
              )}
            </Button>
          ) : null}
          {role.origin && canImport && workflow ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canReimport}
              title={disabledReason}
              onClick={() => setReimportOpen(true)}
            >
              {translate('auto.components.workflows.roles.RoleEditor.reimport', 'Re-import…')}
            </Button>
          ) : null}
        </div>
        <SkillReferenceList
          skills={role.skills}
          onChange={(skills) => onChange({ ...role, skills })}
          allowlistedSources={allowlistedSources}
          onRequestTrust={setTrustSource}
        />
        {role.origin && canImport && workflow && disabledReason ? (
          <p className="text-xs text-muted-foreground">{disabledReason}</p>
        ) : null}
      </div>

      {role.origin ? (
        <div className="space-y-2 rounded-md border border-border p-2 text-xs text-muted-foreground">
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
          {pendingUpstreamVersion !== undefined ? (
            <div role="status" className="space-y-1.5">
              <p>
                {translate(
                  'auto.components.workflows.roles.RoleEditor.upstreamKept',
                  'Your local changes were kept. Version {{version}} is available upstream but was not applied.',
                  { version: pendingUpstreamVersion }
                )}
              </p>
              {overwriteError ? <p className="text-destructive">{overwriteError}</p> : null}
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={overwriteSubmitting || !workflow || workflow.dirty}
                title={
                  workflow?.dirty
                    ? translate(
                        'auto.components.workflows.roles.RoleEditor.overwriteNeedsSave',
                        'Save your changes first — overwriting reloads the workflow from disk and would discard them.'
                      )
                    : undefined
                }
                onClick={() => void handleOverwrite()}
              >
                {overwriteSubmitting ? <Loader2 className="animate-spin" /> : null}
                {translate(
                  'auto.components.workflows.roles.RoleEditor.overwriteLocal',
                  'Overwrite local changes'
                )}
              </Button>
              {workflow?.dirty ? (
                <p className="text-muted-foreground">
                  {translate(
                    'auto.components.workflows.roles.RoleEditor.overwriteNeedsSave',
                    'Save your changes first — overwriting reloads the workflow from disk and would discard them.'
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {repo && settings && !role.origin ? (
        <ImportRoleDialog
          key={importOpen ? 'open' : 'closed'}
          open={importOpen}
          repo={repo}
          settings={settings}
          onOpenChange={setImportOpen}
          onImported={handleNewImport}
        />
      ) : null}

      {repo && settings && role.origin && workflow ? (
        <ImportRoleDialog
          key={reimportOpen ? 'open' : 'closed'}
          open={reimportOpen}
          repo={repo}
          settings={settings}
          initialSource={role.origin.source}
          fixedRoleName={role.id}
          target={{
            workflow: workflow.name,
            workflowSource: workflow.source,
            expectedRevision: workflow.revision ?? undefined
          }}
          onOpenChange={setReimportOpen}
          onImported={(result) => void handleReimportResult(result)}
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
          host={host}
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
