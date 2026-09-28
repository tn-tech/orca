import React, { useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import {
  workflowProposalAccept,
  workflowProposalExport,
  type RuntimeWorkflowSettings
} from '@/runtime/runtime-workflow-client'
import type { Role, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import type { RoleProposalView } from '../../../../../shared/workflows/workflow-run-types'
import { NativeChatDiffView } from '../../native-chat/NativeChatDiffView'
import { DiffLineCounts } from '../../right-sidebar/source-control/listing/diff-line-counts'
import {
  diffLineCounts,
  roleProposalFieldDiffs,
  type RoleProposalFieldDiff,
  type RoleProposalFieldName
} from './workflow-role-proposal-diff'

// Duplicated from `workflow-role-proposals.ts` (src/main/, not importable from the renderer —
// AGENTS.md): which states `workflow.proposal.accept`/`.export` accept, so the buttons disable
// before a doomed round trip instead of only after `workflow_proposal_not_pending` comes back.
const ACCEPTABLE_STATES: ReadonlySet<RoleProposalView['state']> = new Set(['proposed', 'exported'])
const EXPORTABLE_STATES: ReadonlySet<RoleProposalView['state']> = new Set([
  'proposed',
  'exported',
  'accepted'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function allowlistPathFromData(data: unknown): string | undefined {
  return isRecord(data) && typeof data.allowlistPath === 'string' ? data.allowlistPath : undefined
}

/** Same duck-typed read as `ImportRoleDialog.tsx`'s `allowlistPathFromError` — accept goes through
 *  the same save gate as `workflow.write`, so a refused `workflow_source_not_allowed` carries the
 *  same `.data.allowlistPath` naming where to add the source. */
function allowlistPathFromError(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined
  }
  const direct = allowlistPathFromData(error.data)
  if (direct) {
    return direct
  }
  const response = error.response
  return isRecord(response) && isRecord(response.error)
    ? allowlistPathFromData(response.error.data)
    : undefined
}

function proposalStateLabel(state: RoleProposalView['state']): string {
  switch (state) {
    case 'proposed':
      return translate(
        'auto.components.workflows.run-view.RoleProposalPanel.stateProposed',
        'Proposed'
      )
    case 'accepted':
      return translate(
        'auto.components.workflows.run-view.RoleProposalPanel.stateAccepted',
        'Accepted'
      )
    case 'exported':
      return translate(
        'auto.components.workflows.run-view.RoleProposalPanel.stateExported',
        'Exported'
      )
    case 'rejected':
      return translate(
        'auto.components.workflows.run-view.RoleProposalPanel.stateRejected',
        'Rejected'
      )
  }
}

function fieldLabel(field: RoleProposalFieldName): string {
  return field === 'systemPrompt'
    ? translate(
        'auto.components.workflows.run-view.RoleProposalPanel.fieldSystemPrompt',
        'System prompt'
      )
    : translate('auto.components.workflows.run-view.RoleProposalPanel.fieldSkills', 'Skills')
}

/** One field's diff, collapsed by default (US7 review note: a 32,000-char systemPrompt must not
 *  render in full up front) with an added/removed count on the trigger. */
function ProposalFieldDiff({ diff }: { diff: RoleProposalFieldDiff }): React.JSX.Element {
  const counts = diffLineCounts(diff.lines)
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="group w-full min-w-0 justify-start"
          >
            <span className="min-w-0 flex-1 truncate text-left">{fieldLabel(diff.field)}</span>
            <DiffLineCounts added={counts.added} removed={counts.removed} />
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <NativeChatDiffView lines={diff.lines} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

type ProposalActionKind = 'accept' | 'export'

type ProposalActionState = {
  busy?: ProposalActionKind
  error?: string
  conflict: boolean
  /** Present on `workflow_source_not_allowed`; `path` names the allowlist file when the refusal
   *  carried one (`allowlistPathFromError`), same as `ImportRoleDialog`'s own fallback. */
  notAllowlisted?: { path?: string }
  unsupported?: ProposalActionKind
  exportPath?: string
}

function initialActionState(): ProposalActionState {
  return { conflict: false }
}

export type RoleProposalCardProps = {
  runId: string
  proposal: RoleProposalView
  /** The role as of the run that produced the proposal (`RunSnapshot.workflowSnapshot.roles`) —
   *  the value the proposal's `change` is actually relative to, available without a second
   *  `workflow.read` round trip. `undefined` if the role no longer exists in the workflow. */
  role: Role | undefined
  settings: RuntimeWorkflowSettings
  onWorkflowFileChanged?: () => void
  onReloadFromDisk?: () => void | Promise<void>
}

/** One proposal: role, evidence, a collapsed diff per changed field, and Accept/Export. */
export function RoleProposalCard({
  runId,
  proposal,
  role,
  settings,
  onWorkflowFileChanged,
  onReloadFromDisk
}: RoleProposalCardProps): React.JSX.Element {
  const [state, setState] = useState<ProposalActionState>(initialActionState)
  const diffs = roleProposalFieldDiffs(role, proposal.change)
  const canAccept = ACCEPTABLE_STATES.has(proposal.state)
  const canExport = EXPORTABLE_STATES.has(proposal.state)
  const exportDisabledReason = !role?.origin
    ? translate(
        'auto.components.workflows.run-view.RoleProposalPanel.exportNotImported',
        'Only a role imported from a repository can be exported.'
      )
    : undefined
  const busy = state.busy !== undefined

  async function accept(): Promise<void> {
    setState({ ...initialActionState(), busy: 'accept' })
    try {
      await workflowProposalAccept(settings, { runId, proposalId: proposal.id })
      setState(initialActionState())
      onWorkflowFileChanged?.()
    } catch (err) {
      if (hasRuntimeRpcErrorCode(err, 'method_not_found')) {
        setState({ ...initialActionState(), unsupported: 'accept' })
      } else if (hasRuntimeRpcErrorCode(err, 'workflow_file_conflict')) {
        setState({ ...initialActionState(), conflict: true })
      } else if (hasRuntimeRpcErrorCode(err, 'workflow_source_not_allowed')) {
        setState({ ...initialActionState(), notAllowlisted: { path: allowlistPathFromError(err) } })
      } else {
        setState({
          ...initialActionState(),
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }

  async function exportProposal(): Promise<void> {
    setState({ ...initialActionState(), busy: 'export' })
    try {
      const result = await workflowProposalExport(settings, { runId, proposalId: proposal.id })
      setState({ ...initialActionState(), exportPath: result.exportPath })
    } catch (err) {
      if (hasRuntimeRpcErrorCode(err, 'method_not_found')) {
        setState({ ...initialActionState(), unsupported: 'export' })
      } else {
        setState({
          ...initialActionState(),
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {role?.name ?? proposal.roleId}
        </span>
        <Badge variant={proposal.state === 'proposed' ? 'outline' : 'secondary'}>
          {proposalStateLabel(proposal.state)}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground italic">{proposal.evidence}</p>
      <div className="space-y-1.5">
        {diffs.map((diff) => (
          <ProposalFieldDiff key={diff.field} diff={diff} />
        ))}
      </div>

      {state.conflict ? (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-2 text-xs">
          <p>
            {translate(
              'auto.components.workflows.run-view.RoleProposalPanel.fileConflict',
              '"{{role}}" changed on disk since this run, so this proposal — a frozen snapshot from when the run happened — can\'t be applied as-is. Reload the workflow to see the current version before deciding.',
              { role: role?.name ?? proposal.roleId }
            )}
          </p>
          {onReloadFromDisk ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onReloadFromDisk()}
            >
              {translate(
                'auto.components.workflows.run-view.RoleProposalPanel.reload',
                'Reload workflow'
              )}
            </Button>
          ) : null}
        </div>
      ) : null}

      {state.notAllowlisted ? (
        <p className="text-xs text-destructive">
          {state.notAllowlisted.path
            ? translate(
                'auto.components.workflows.run-view.RoleProposalPanel.notAllowlisted',
                "The role's source is not on the project allowlist. Add it to workflows.allowedSources in {{path}}.",
                { path: state.notAllowlisted.path }
              )
            : translate(
                'auto.components.workflows.run-view.RoleProposalPanel.notAllowlistedNoPath',
                "The role's source is not on the project allowlist."
              )}
        </p>
      ) : null}

      {state.unsupported ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.run-view.RoleProposalPanel.methodNotSupported',
            "This isn't available on this host yet."
          )}
        </p>
      ) : null}

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}

      {state.exportPath ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.run-view.RoleProposalPanel.exported',
            'Exported to {{path}}.',
            { path: state.exportPath }
          )}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!canAccept || busy} onClick={() => void accept()}>
          {state.busy === 'accept' ? <Loader2 className="animate-spin" /> : null}
          {translate('auto.components.workflows.run-view.RoleProposalPanel.accept', 'Accept')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canExport || exportDisabledReason !== undefined || busy}
          title={exportDisabledReason}
          onClick={() => void exportProposal()}
        >
          {state.busy === 'export' ? <Loader2 className="animate-spin" /> : null}
          {translate('auto.components.workflows.run-view.RoleProposalPanel.export', 'Export')}
        </Button>
      </div>
    </div>
  )
}

export type RoleProposalPanelProps = {
  runId: string
  proposals: readonly RoleProposalView[]
  /** `RunSnapshot.workflowSnapshot.roles` — the roles as of the run, keyed by role id. */
  roles: Workflow['roles']
  settings: RuntimeWorkflowSettings
  /** The run's workflow file changed (an Accept just wrote it) — re-checks the open editor for
   *  external changes if it has this workflow open (`use-workflow-editor-session.ts`'s
   *  `checkForExternalChange`): silently reloads when clean, or raises the existing conflict
   *  dialog when dirty, so an accepted proposal never gets silently clobbered or silently lost. */
  onWorkflowFileChanged?: () => void
  /** Re-checks the open editor against disk — offered on `workflow_file_conflict` (the role
   *  changed on disk since the run). Review round 1 (Important): callers must pass
   *  `session.checkForExternalChange`, not a raw reload — that adopts the newer file silently
   *  only when the editor has no unsaved edits, and raises the existing conflict dialog instead
   *  of clobbering them otherwise. */
  onReloadFromDisk?: () => void | Promise<void>
}

/**
 * US7 AS1/AS2/AS3: every role proposal a run's Reflection node(s) produced, each as a diff against
 * the role, with Accept (`workflow.proposal.accept`) and Export (`workflow.proposal.export`).
 */
export default function RoleProposalPanel({
  runId,
  proposals,
  roles,
  settings,
  onWorkflowFileChanged,
  onReloadFromDisk
}: RoleProposalPanelProps): React.JSX.Element | null {
  if (proposals.length === 0) {
    return null
  }
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {translate(
          'auto.components.workflows.run-view.RoleProposalPanel.heading',
          'Role proposals'
        )}
      </h3>
      {proposals.map((item) => (
        <RoleProposalCard
          key={item.id}
          runId={runId}
          proposal={item}
          role={roles[item.roleId]}
          settings={settings}
          onWorkflowFileChanged={onWorkflowFileChanged}
          onReloadFromDisk={onReloadFromDisk}
        />
      ))}
    </div>
  )
}
