import React from 'react'
import { GitBranch, Package } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { SkillSource } from '../../../../../shared/workflows/workflow-definition-types'

export type SkillSourceBadgeProps = {
  source: SkillSource
  /** Repository sources only (FR-015a). Omit while the caller hasn't loaded the project
   *  allowlist yet — that's "unknown", not "disallowed". */
  allowlisted?: boolean
}

/** Compact source summary for a `SkillReference`: a plugin name, or a repository location plus
 *  version, so a skill row reads as "name — where it comes from" without a wide column. */
export default function SkillSourceBadge({
  source,
  allowlisted
}: SkillSourceBadgeProps): React.JSX.Element {
  const isRepository = source.kind === 'repository'
  const flaggedDisallowed = isRepository && allowlisted === false
  const label = isRepository ? source.location : source.plugin

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={flaggedDisallowed ? 'destructive' : 'outline'} className="max-w-40">
          {isRepository ? (
            <GitBranch className="size-3" aria-hidden="true" />
          ) : (
            <Package className="size-3" aria-hidden="true" />
          )}
          <span className="truncate">{label}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {isRepository
          ? source.version
            ? translate(
                'auto.components.workflows.roles.SkillSourceBadge.repositoryWithVersion',
                '{{location}} @ {{version}}',
                { location: source.location, version: source.version }
              )
            : source.location
          : translate(
              'auto.components.workflows.roles.SkillSourceBadge.plugin',
              'Plugin: {{plugin}}',
              { plugin: source.plugin }
            )}
        {flaggedDisallowed ? (
          <p className="mt-1 text-destructive">
            {translate(
              'auto.components.workflows.roles.SkillSourceBadge.notAllowlisted',
              'Not on the project allowlist.'
            )}
          </p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}
