// Per-source, per-host trust for host-scope plugin installs (FR-018a). Decisions live in
// `workflow_source_trust`; a missing decision raises a `trust` question in the run's question
// store, and deciding answers every pending question for that source on that host.
//
// Host key: `local` (the machine this runtime runs on), `ssh:<connectionId>` (the SSH target a
// repo is bound to), `wsl:<distro>`. The table's single `source` key column holds the plain
// source for `local` and `JSON.stringify([host, source])` elsewhere, so no schema change is needed.
import {
  isWorkflowPluginId,
  WORKFLOW_PLUGIN_ID_MESSAGE
} from '../../../shared/workflows/workflow-plugin-id'
import type { RunQuestionView } from '../../../shared/workflows/workflow-run-types'
import {
  LOCAL_TRUST_HOST,
  workflowTrustHostKey
} from '../../../shared/workflows/workflow-trust-host-key'
import {
  trustQuestionSubject,
  type TrustQuestionSubject
} from '../../../shared/workflows/workflow-trust-question-subject'
import type { OrchestrationDb } from '../orchestration/db'
import type { WorkflowSourceTrustDecision } from '../orchestration/db/workflow-runs/workflow-trust-store'
import type { WorkflowRunChangeNotifier } from './workflow-run-recorder'
import { WorkflowRunRecorder } from './workflow-run-recorder'
import type { WorkflowSkillTrustGate } from './workflow-skill-provisioning'

export { LOCAL_TRUST_HOST, workflowTrustHostKey, trustQuestionSubject }

export type SourceTrustDecisionView = {
  source: string
  host: string
  decision: WorkflowSourceTrustDecision
  decidedBy: string
  decidedAt: string
}

/** A valid plugin id never starts with `[`, so a local key cannot collide with an encoded one. */
function trustRecordKey(host: string, source: string): string {
  if (!isWorkflowPluginId(source)) {
    throw new Error(`Cannot record trust for "${source}": ${WORKFLOW_PLUGIN_ID_MESSAGE}`)
  }
  return host === LOCAL_TRUST_HOST ? source : JSON.stringify([host, source])
}

function parseTrustRecordKey(key: string): { host: string; source: string } {
  if (key.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(key)
      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        typeof parsed[0] === 'string' &&
        typeof parsed[1] === 'string'
      ) {
        return { host: parsed[0], source: parsed[1] }
      }
    } catch {
      // A plain source that merely starts with "[" is a local decision.
    }
  }
  return { host: LOCAL_TRUST_HOST, source: key }
}

export function sourceTrustGate(db: OrchestrationDb, host: string): WorkflowSkillTrustGate {
  return {
    decide: async ({ source }) =>
      db.getSourceTrust(trustRecordKey(host, source))?.decision ?? 'needs-question'
  }
}

export function listSourceTrustDecisions(db: OrchestrationDb): SourceTrustDecisionView[] {
  return db.listSourceTrust().map((view) => ({
    ...parseTrustRecordKey(view.source),
    decision: view.decision,
    decidedBy: view.decidedBy,
    decidedAt: view.decidedAt
  }))
}

export const TRUST_QUESTION_CHOICES = [
  { id: 'trusted', label: 'Trust this source' },
  { id: 'refused', label: 'Refuse' }
] as const

type TrustQuestionArgs = { runId: string; attemptId: string; question: TrustQuestionSubject }

/**
 * Reuses the attempt's pending trust question for the same source on the same host rather than
 * asking twice; `created` says whether this call asked it.
 */
export function raiseTrustQuestion(
  db: OrchestrationDb,
  { runId, attemptId, question }: TrustQuestionArgs
): { question: RunQuestionView; created: boolean } {
  const existing = db
    .listPendingWorkflowQuestions(runId)
    .find(
      (candidate) =>
        candidate.attemptId === attemptId &&
        trustQuestionSubject(candidate)?.source === question.source &&
        trustQuestionSubject(candidate)?.host === question.host
    )
  if (existing) {
    return { question: existing, created: false }
  }
  const created = db.createWorkflowQuestion({
    runId,
    attemptId,
    kind: 'trust',
    prompt:
      `Trust plugin source "${question.source}" on host ${question.host}? Orca will install ` +
      `skill(s) ${question.skills.join(', ')} there for ${question.agents.join(', ')}.`,
    options: { choices: [...TRUST_QUESTION_CHOICES], trust: question }
  })
  return { question: created, created: true }
}

/**
 * Forgets a source's decision on `host` (FR-018a "revocable from settings"): the next run
 * needing it there asks again, unlike deciding `refused` (which fails the node instead of
 * asking). A no-op when nothing is recorded for that source and host.
 */
export function revokeSourceTrust(
  db: OrchestrationDb,
  args: { host: string; source: string }
): void {
  db.clearSourceTrust(trustRecordKey(args.host, args.source))
}

/**
 * Records `decision` for `source` on `host` and answers every pending trust question about it.
 * Returns the runs whose questions were answered, so their controllers can be woken.
 */
export function decideSourceTrust(
  db: OrchestrationDb,
  notifier: WorkflowRunChangeNotifier,
  args: { host: string; source: string; decision: WorkflowSourceTrustDecision; decidedBy: string }
): string[] {
  const { host, source, decision, decidedBy } = args
  db.setSourceTrust(trustRecordKey(host, source), decision, decidedBy)
  const runIds = new Set<string>()
  for (const question of db.listPendingWorkflowQuestions()) {
    const subject = trustQuestionSubject(question)
    if (subject?.source !== source || subject.host !== host) {
      continue
    }
    if (db.answerWorkflowQuestion(question.id, decision, decidedBy)?.state === 'answered') {
      new WorkflowRunRecorder(db, notifier, question.runId).event(
        'trust_question_answered',
        { questionId: question.id, source, host, decision },
        { attemptId: question.attemptId, reason: 'question' }
      )
      runIds.add(question.runId)
    }
  }
  return [...runIds]
}
