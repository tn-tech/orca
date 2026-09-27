import React, { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import {
  workflowTrustDecide,
  workflowTrustList,
  workflowTrustRevoke,
  type RuntimeWorkflowSettings,
  type WorkflowTrustDecision
} from '@/runtime/runtime-workflow-client'

export type TrustedSourcesListProps = {
  settings: RuntimeWorkflowSettings
}

function sortDecisions(decisions: WorkflowTrustDecision[]): WorkflowTrustDecision[] {
  return [...decisions].sort(
    (a, b) => a.host.localeCompare(b.host) || a.source.localeCompare(b.source)
  )
}

function decisionKey(decision: Pick<WorkflowTrustDecision, 'host' | 'source'>): string {
  return `${decision.host}:${decision.source}`
}

/** `workflow.trust.decide`/`.revoke` default to `local`; only a non-local host needs to travel. */
function hostParam(host: string): { host: string } | Record<string, never> {
  return host === 'local' ? {} : { host }
}

function TrustDecisionRow({
  decision,
  busy,
  revokeDisabled,
  onRevoke,
  onTrust
}: {
  decision: WorkflowTrustDecision
  busy: boolean
  revokeDisabled: boolean
  onRevoke: () => void
  onTrust: () => void
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
                'auto.components.workflows.TrustedSourcesList.trusted',
                'Trusted {{when}}',
                { when: new Date(decision.decidedAt).toLocaleString() }
              )
            : translate(
                'auto.components.workflows.TrustedSourcesList.refused',
                'Refused {{when}}',
                { when: new Date(decision.decidedAt).toLocaleString() }
              )}
        </p>
      </div>
      {decision.decision === 'trusted' ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || revokeDisabled}
          title={
            revokeDisabled
              ? translate(
                  'auto.components.workflows.TrustedSourcesList.revokeUnsupportedTitle',
                  "This host's Orca must be updated to revoke trust."
                )
              : undefined
          }
          onClick={onRevoke}
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          {translate('auto.components.workflows.TrustedSourcesList.revoke', 'Revoke')}
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onTrust}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {translate('auto.components.workflows.TrustedSourcesList.trust', 'Trust')}
        </Button>
      )}
    </li>
  )
}

/**
 * FR-018a: trust decisions must be "revocable from settings". Revoking forgets the decision
 * (`workflow.trust.revoke`) so the next run on that host asks again — unlike deciding `refused`,
 * which fails the node instead of asking. A refused row can also be trusted from here. Shared by
 * `WorkflowsTrustExperimentalSetting` (Settings > Experimental) and `TrustedSourcesDialog` (the
 * Workflows page's shortcut to the same list).
 */
export default function TrustedSourcesList({
  settings
}: TrustedSourcesListProps): React.JSX.Element {
  const [decisions, setDecisions] = useState<WorkflowTrustDecision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [busyKey, setBusyKey] = useState<string | undefined>()
  // Sticky once seen: an older host refuses the whole method, not just one row, and asking again
  // per row would just repeat the same failure.
  const [revokeUnsupported, setRevokeUnsupported] = useState(false)

  const activeRuntimeEnvironmentId = settings?.activeRuntimeEnvironmentId
  // `settings` is a fresh object on every store update; reading it through a ref (never a
  // reactive dependency) instead of the closed-over variable keeps this effect firing only when
  // `activeRuntimeEnvironmentId` actually changes, while still calling with the current settings.
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    // A different host may well support revoke even when the last one didn't.
    setRevokeUnsupported(false)
    workflowTrustList(settingsRef.current)
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
  }, [activeRuntimeEnvironmentId])

  async function revoke(decision: WorkflowTrustDecision): Promise<void> {
    const key = decisionKey(decision)
    setBusyKey(key)
    setError(undefined)
    try {
      await workflowTrustRevoke(settings, { source: decision.source, ...hostParam(decision.host) })
      setDecisions((current) => current.filter((candidate) => decisionKey(candidate) !== key))
    } catch (err) {
      if (
        hasRuntimeRpcErrorCode(err, 'method_not_found') ||
        hasRuntimeRpcErrorCode(err, 'forbidden')
      ) {
        setRevokeUnsupported(true)
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setBusyKey(undefined)
    }
  }

  async function trust(decision: WorkflowTrustDecision): Promise<void> {
    const key = decisionKey(decision)
    setBusyKey(key)
    setError(undefined)
    try {
      await workflowTrustDecide(settings, {
        source: decision.source,
        decision: 'trusted',
        ...hostParam(decision.host)
      })
      setDecisions((current) =>
        current.map((candidate) =>
          decisionKey(candidate) === key ? { ...candidate, decision: 'trusted' } : candidate
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyKey(undefined)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        {translate('auto.components.workflows.TrustedSourcesList.loading', 'Loading…')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {revokeUnsupported ? (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.workflows.TrustedSourcesList.revokeUnsupported',
            "This host's Orca must be updated to revoke trust. Meanwhile, run `orca workflows trust <source> --decision refused` from a shell on that host to refuse a source instead."
          )}
        </p>
      ) : null}
      {decisions.length > 0 ? (
        <ul className="max-h-80 space-y-1.5 overflow-auto scrollbar-sleek">
          {sortDecisions(decisions).map((decision) => (
            <TrustDecisionRow
              key={decisionKey(decision)}
              decision={decision}
              busy={busyKey === decisionKey(decision)}
              revokeDisabled={revokeUnsupported}
              onRevoke={() => void revoke(decision)}
              onTrust={() => void trust(decision)}
            />
          ))}
        </ul>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">
          {translate(
            'auto.components.workflows.TrustedSourcesList.empty',
            'No trust decisions yet.'
          )}
        </p>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
