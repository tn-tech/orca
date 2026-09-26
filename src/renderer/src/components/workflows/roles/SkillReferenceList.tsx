import React, { useRef } from 'react'
import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type {
  SkillReference,
  SkillSource
} from '../../../../../shared/workflows/workflow-definition-types'
import SkillSourceBadge from './SkillSourceBadge'

export type SkillReferenceListProps = {
  skills: SkillReference[]
  onChange: (skills: SkillReference[]) => void
  /** Project allowlist (FR-015a), for flagging a repository source that isn't on it yet. */
  allowlistedSources?: readonly string[]
  /** Offers a "Trust" action on plugin-sourced skills not yet decided (FR-018a). Omitted where
   *  the caller has no place to send the decision (e.g. a standalone list in a test). */
  onRequestTrust?: (source: SkillSource) => void
}

function isRepositoryAllowlisted(
  source: SkillSource,
  allowlistedSources: readonly string[] | undefined
): boolean | undefined {
  if (source.kind !== 'repository' || allowlistedSources === undefined) {
    return undefined
  }
  return allowlistedSources.includes(source.location)
}

/** Editable list of a role's (or a node override's) skills (data-model.md §1 `SkillReference`):
 *  name, source (plugin name, or repository location + optional version), and required. Shared
 *  by `roles/RoleEditor.tsx` and `editor/AgentNodeFields.tsx`'s skills override. */
export default function SkillReferenceList({
  skills,
  onChange,
  allowlistedSources,
  onRequestTrust
}: SkillReferenceListProps): React.JSX.Element {
  // Why: skills have no id of their own; a stable per-row key keeps a row's inputs (and focus)
  // attached to that row when a different row is removed, instead of the array index. Lazy-
  // seeded (lazy-use-ref-ratchet.test.ts) so this isn't recomputed and thrown away every render.
  const rowKeysRef = useRef<string[]>(undefined!)
  rowKeysRef.current ??= skills.map(() => createBrowserUuid())
  const keyedSkills = skills.map((skill, index) => ({
    rowKey: rowKeysRef.current[index] ?? createBrowserUuid(),
    skill,
    index
  }))

  function updateSkill(index: number, patch: Partial<SkillReference>): void {
    onChange(skills.map((skill, i) => (i === index ? { ...skill, ...patch } : skill)))
  }

  function setSourceKind(index: number, kind: SkillSource['kind']): void {
    updateSkill(index, {
      source:
        kind === 'plugin' ? { kind: 'plugin', plugin: '' } : { kind: 'repository', location: '' }
    })
  }

  function removeSkill(index: number): void {
    rowKeysRef.current = rowKeysRef.current.filter((_, i) => i !== index)
    onChange(skills.filter((_, i) => i !== index))
  }

  function addSkill(): void {
    rowKeysRef.current = [...rowKeysRef.current, createBrowserUuid()]
    onChange([...skills, { name: '', source: { kind: 'plugin', plugin: '' }, required: true }])
  }

  return (
    <div className="space-y-2">
      {keyedSkills.map(({ rowKey, skill, index }) => (
        <SkillReferenceRow
          key={rowKey}
          skill={skill}
          allowlistedSources={allowlistedSources}
          onRequestTrust={onRequestTrust}
          onUpdate={(patch) => updateSkill(index, patch)}
          onSetSourceKind={(kind) => setSourceKind(index, kind)}
          onRemove={() => removeSkill(index)}
        />
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addSkill}>
        <Plus />
        {translate('auto.components.workflows.roles.SkillReferenceList.addSkill', 'Add skill')}
      </Button>
    </div>
  )
}

type SkillReferenceRowProps = {
  skill: SkillReference
  allowlistedSources: readonly string[] | undefined
  onRequestTrust: ((source: SkillSource) => void) | undefined
  onUpdate: (patch: Partial<SkillReference>) => void
  onSetSourceKind: (kind: SkillSource['kind']) => void
  onRemove: () => void
}

/** One skill's row. Its own component (rather than inlined in the `.map()` above) so narrowing
 *  `source` by `kind` holds inside the field-change closures below — TS doesn't carry a
 *  discriminated-union narrowing performed in an enclosing scope into a nested arrow function. */
function SkillReferenceRow({
  skill,
  allowlistedSources,
  onRequestTrust,
  onUpdate,
  onSetSourceKind,
  onRemove
}: SkillReferenceRowProps): React.JSX.Element {
  const source = skill.source

  return (
    <div className="space-y-1.5 rounded-md border border-border p-2">
      <div className="flex items-center gap-1.5">
        <Input
          value={skill.name}
          onChange={(event) => onUpdate({ name: event.target.value })}
          placeholder={translate(
            'auto.components.workflows.roles.SkillReferenceList.namePlaceholder',
            'Skill name'
          )}
          className="h-8 min-w-0 flex-1"
          aria-label={translate(
            'auto.components.workflows.roles.SkillReferenceList.nameLabel',
            'Skill name'
          )}
        />
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={skill.required}
            onCheckedChange={(checked) => onUpdate({ required: checked === true })}
          />
          {translate('auto.components.workflows.roles.SkillReferenceList.required', 'Required')}
        </label>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          aria-label={translate(
            'auto.components.workflows.roles.SkillReferenceList.removeSkill',
            'Remove skill'
          )}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          value={source.kind}
          onValueChange={(value) =>
            value === 'plugin' || value === 'repository' ? onSetSourceKind(value) : undefined
          }
        >
          <SelectTrigger
            className="h-8 w-28"
            aria-label={translate(
              'auto.components.workflows.roles.SkillReferenceList.sourceKindLabel',
              'Source'
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="plugin">
              {translate(
                'auto.components.workflows.roles.SkillReferenceList.sourceKindPlugin',
                'Plugin'
              )}
            </SelectItem>
            <SelectItem value="repository">
              {translate(
                'auto.components.workflows.roles.SkillReferenceList.sourceKindRepository',
                'Repository'
              )}
            </SelectItem>
          </SelectContent>
        </Select>
        {source.kind === 'plugin' ? (
          <Input
            value={source.plugin}
            onChange={(event) =>
              onUpdate({ source: { kind: 'plugin', plugin: event.target.value } })
            }
            placeholder={translate(
              'auto.components.workflows.roles.SkillReferenceList.pluginPlaceholder',
              'Plugin name'
            )}
            className="h-8 min-w-0 flex-1"
            aria-label={translate(
              'auto.components.workflows.roles.SkillReferenceList.pluginLabel',
              'Plugin name'
            )}
          />
        ) : (
          <>
            <Input
              value={source.location}
              onChange={(event) =>
                onUpdate({ source: { ...source, location: event.target.value } })
              }
              placeholder={translate(
                'auto.components.workflows.roles.SkillReferenceList.locationPlaceholder',
                'Repository location'
              )}
              className="h-8 min-w-0 flex-1"
              aria-label={translate(
                'auto.components.workflows.roles.SkillReferenceList.locationLabel',
                'Repository location'
              )}
            />
            <Input
              value={source.version ?? ''}
              onChange={(event) =>
                onUpdate({ source: { ...source, version: event.target.value || undefined } })
              }
              placeholder={translate(
                'auto.components.workflows.roles.SkillReferenceList.versionPlaceholder',
                'Version (optional)'
              )}
              className="h-8 w-28"
              aria-label={translate(
                'auto.components.workflows.roles.SkillReferenceList.versionLabel',
                'Version'
              )}
            />
          </>
        )}
        {(source.kind === 'plugin' ? source.plugin : source.location) ? (
          <SkillSourceBadge
            source={source}
            allowlisted={isRepositoryAllowlisted(source, allowlistedSources)}
          />
        ) : null}
        {source.kind === 'plugin' && source.plugin && onRequestTrust ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onRequestTrust(source)}>
            <ShieldCheck />
            {translate('auto.components.workflows.roles.SkillReferenceList.trust', 'Trust…')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
