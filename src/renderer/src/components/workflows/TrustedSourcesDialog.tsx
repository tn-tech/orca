import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import {
  workflowTrustDecide,
  workflowTrustList,
  type RuntimeWorkflowSettings,
  type WorkflowTrustDecision
} from '@/runtime/runtime-workflow-client'

export type TrustedSourcesDialogProps = {
  open: boolean
  settings: RuntimeWorkflowSettings
  onOpenChange: (open: boolean) => void
}

function sortDecisions(decisions: WorkflowTrustDecision[]): WorkflowTrustDecision[] {
  return [...decisions].sort(
    (a, b) => a.host.localeCompare(b.host) || a.source.localeCompare(b.source)
  )
}

function TrustDecisionRow({
  decision,
  revoking,
  onRevoke
}: {
  decision: WorkflowTrustDecision
  revoking: boolean
  onRevoke: () => void
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-2 rounded-md border border-border p-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-xs">{decision.source}</span>
          <Badge variant="hostContext">{decision.host}</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {decision.decision === 'trusted'
            ? translate(
                'auto.components.workflows.TrustedSourcesDialog.trusted',
                'Trusted {{when}}',
                { when: decision.decidedAt }
              )
            : translate(
                'auto.components.workflows.TrustedSourcesDialog.refused',
                'Refused {{when}}',
                { when: decision.decidedAt }
              )}
        </p>
      </div>
      {decision.decision === 'trusted' ? (
        <Button type="button" size="sm" variant="outline" disabled={revoking} onClick={onRevoke}>
          {revoking ? <Loader2 className="animate-spin" /> : null}
          {translate('auto.components.workflows.TrustedSourcesDialog.revoke', 'Revoke')}
        </Button>
      ) : null}
    </li>
  )
}

/** FR-018a: trust decisions must be "revocable from settings" — revoking a trusted source
 *  re-decides it as `refused` on the same host (`workflow.trust.decide`'s own semantics: deciding
 *  again replaces the earlier decision), so the next run on that host asks again after a fresh
 *  install, rather than silently continuing to trust it. */
export default function TrustedSourcesDialog({
  open,
  settings,
  onOpenChange
}: TrustedSourcesDialogProps): React.JSX.Element {
  const [decisions, setDecisions] = useState<WorkflowTrustDecision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [revokingKey, setRevokingKey] = useState<string | undefined>()

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    setLoading(true)
    setError(undefined)
    workflowTrustList(settings)
      .then((result) => {
        if (!cancelled) {
          setDecisions(result.decisions)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, settings])

  async function revoke(decision: WorkflowTrustDecision): Promise<void> {
    const key = `${decision.host}:${decision.source}`
    setRevokingKey(key)
    setError(undefined)
    try {
      await workflowTrustDecide(settings, {
        source: decision.source,
        decision: 'refused',
        ...(decision.host !== 'local' ? { host: decision.host } : {})
      })
      setDecisions((current) =>
        current.map((candidate) =>
          candidate.host === decision.host && candidate.source === decision.source
            ? { ...candidate, decision: 'refused' }
            : candidate
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRevokingKey(undefined)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.workflows.TrustedSourcesDialog.title',
              'Trusted skill sources'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.workflows.TrustedSourcesDialog.description',
              'One decision per plugin source and host (FR-018a). Revoking asks again the next time a run needs it there.'
            )}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            {translate('auto.components.workflows.TrustedSourcesDialog.loading', 'Loading…')}
          </div>
        ) : decisions.length > 0 ? (
          <ul className="max-h-80 space-y-1.5 overflow-auto scrollbar-sleek">
            {sortDecisions(decisions).map((decision) => (
              <TrustDecisionRow
                key={`${decision.host}:${decision.source}`}
                decision={decision}
                revoking={revokingKey === `${decision.host}:${decision.source}`}
                onRevoke={() => void revoke(decision)}
              />
            ))}
          </ul>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">
            {translate(
              'auto.components.workflows.TrustedSourcesDialog.empty',
              'No trust decisions yet.'
            )}
          </p>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  )
}
