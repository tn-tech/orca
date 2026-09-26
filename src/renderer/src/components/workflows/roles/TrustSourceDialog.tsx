import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import {
  workflowTrustDecide,
  type RuntimeWorkflowSettings
} from '@/runtime/runtime-workflow-client'

export type TrustSourceDecision = 'trusted' | 'refused'

export type TrustSourceDialogProps = {
  open: boolean
  settings: RuntimeWorkflowSettings
  source: string
  /** Skill names this source provides, so the person can see what they're deciding on. */
  skills: readonly string[]
  /** Agents whose runs would use this source once trusted. */
  agents: readonly string[]
  onOpenChange: (open: boolean) => void
  onDecided?: (decision: TrustSourceDecision) => void
}

/** FR-018a: shows the source, the skills it provides and the agents affected before recording a
 *  per-source, per-host trust decision. A refusal fails the node without installing; the decision
 *  is remembered for every later run on this host and stays revocable from settings. */
export default function TrustSourceDialog({
  open,
  settings,
  source,
  skills,
  agents,
  onOpenChange,
  onDecided
}: TrustSourceDialogProps): React.JSX.Element {
  const [submitting, setSubmitting] = useState<TrustSourceDecision | undefined>()
  const [error, setError] = useState<string | undefined>()

  async function decide(decision: TrustSourceDecision): Promise<void> {
    setSubmitting(decision)
    setError(undefined)
    try {
      await workflowTrustDecide(settings, { source, decision })
      onDecided?.(decision)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(undefined)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.workflows.roles.TrustSourceDialog.title',
              'Trust this source?'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.workflows.roles.TrustSourceDialog.description',
              'This decision is remembered for every later run on this host and can be revoked from settings.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2 text-sm">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {translate('auto.components.workflows.roles.TrustSourceDialog.sourceLabel', 'Source')}
            </p>
            <p className="break-all font-mono text-xs">{source}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {translate(
                'auto.components.workflows.roles.TrustSourceDialog.skillsLabel',
                'Skills provided'
              )}
            </p>
            {skills.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {skills.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.workflows.roles.TrustSourceDialog.noSkills',
                  'None named yet.'
                )}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {translate(
                'auto.components.workflows.roles.TrustSourceDialog.agentsLabel',
                'Agents affected'
              )}
            </p>
            <p className="text-xs">
              {agents.length > 0
                ? agents.join(', ')
                : translate(
                    'auto.components.workflows.roles.TrustSourceDialog.noAgents',
                    'None yet.'
                  )}
            </p>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting !== undefined}
            onClick={() => void decide('refused')}
          >
            {submitting === 'refused' ? <Loader2 className="animate-spin" /> : null}
            {translate('auto.components.workflows.roles.TrustSourceDialog.refuse', 'Refuse')}
          </Button>
          <Button
            type="button"
            disabled={submitting !== undefined}
            onClick={() => void decide('trusted')}
          >
            {submitting === 'trusted' ? <Loader2 className="animate-spin" /> : null}
            {translate('auto.components.workflows.roles.TrustSourceDialog.trust', 'Trust')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
