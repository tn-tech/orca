import { Fragment } from 'react'
import { Text, View } from 'react-native'
import type { WorkflowRunState } from '../../../src/shared/workflows/workflow-node-states'
import { questionExpiryReason } from '../../../src/shared/workflows/workflow-question-expiry-reason'
import { colors } from '../theme/mobile-theme'
import { WorkflowPromptCard } from './WorkflowPromptCard'
import {
  isAnswerableWorkflowQuestion,
  type MobileWorkflowQuestion
} from './workflow-run-reply-schema'
import type {
  MobileWorkflowRunEntry,
  WorkflowAnswerOutcome,
  WorkflowQuestionAnswer
} from './workflow-run-operations'
import { workflowStyles as styles } from './workflow-run-styles'

export type WorkflowRunListProps = {
  runs: readonly MobileWorkflowRunEntry[]
  onAnswer: (
    question: MobileWorkflowQuestion,
    answer: WorkflowQuestionAnswer
  ) => Promise<WorkflowAnswerOutcome>
}

/** Enough settled answers to show what just happened on a phone without burying the list. */
const RECENT_SETTLED_LIMIT = 3

const RUN_STATE_LABELS: Record<WorkflowRunState, { label: string; color: string }> = {
  queued: { label: 'Queued', color: colors.textSecondary },
  running: { label: 'Running', color: colors.accentBlue },
  paused: { label: 'Paused', color: colors.textSecondary },
  waiting: { label: 'Waiting', color: colors.statusAmber },
  completed: { label: 'Completed', color: colors.statusGreen },
  failed: { label: 'Failed', color: colors.statusRed },
  cancelled: { label: 'Cancelled', color: colors.textMuted }
}

function RunRow({
  entry: { run, questions, events },
  onAnswer
}: {
  entry: MobileWorkflowRunEntry
  onAnswer: WorkflowRunListProps['onAnswer']
}) {
  const state = run.state
    ? RUN_STATE_LABELS[run.state]
    : { label: 'Unknown', color: colors.textMuted }
  const when = run.startedAt ?? run.createdAt
  const settled = questions
    .filter((question) => !isAnswerableWorkflowQuestion(question))
    .slice(-RECENT_SETTLED_LIMIT)
  return (
    <View style={styles.runRow}>
      <View style={styles.runRowHeader}>
        <Text style={styles.runName} numberOfLines={1}>
          {run.workflowName}
        </Text>
        <Text style={[styles.meta, { color: state.color }]}>{state.label}</Text>
      </View>
      {run.objective ? (
        <Text style={styles.meta} numberOfLines={2}>
          {run.objective}
        </Text>
      ) : null}
      {when ? <Text style={styles.meta}>{new Date(when).toLocaleString()}</Text> : null}
      {settled.map((question) => (
        <WorkflowPromptCard
          key={question.id}
          question={question}
          onAnswer={(answer) => onAnswer(question, answer)}
          expiredReason={
            question.state === 'expired' ? questionExpiryReason(events, question.id) : undefined
          }
        />
      ))}
    </View>
  )
}

/** Open workflow prompts across runs (answerable here), then every recent run with its state and
 *  its latest settled questions (FR-040: who answered, what, or why it closed unanswered). */
export function WorkflowRunList({ runs, onAnswer }: WorkflowRunListProps) {
  const waiting = runs.flatMap(({ run, questions }) =>
    questions.filter(isAnswerableWorkflowQuestion).map((question) => ({ run, question }))
  )
  return (
    <View>
      {waiting.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Needs you</Text>
          {waiting.map(({ run, question }) => (
            <View key={question.id} style={styles.promptGroup}>
              <Text style={styles.meta} numberOfLines={1}>
                {run.workflowName}
              </Text>
              <WorkflowPromptCard
                question={question}
                onAnswer={(answer) => onAnswer(question, answer)}
              />
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Runs</Text>
        {runs.length === 0 ? (
          <Text style={styles.meta}>No workflow runs yet. Start one from the desktop app.</Text>
        ) : (
          <View style={styles.runCard}>
            {runs.map((entry, index) => (
              <Fragment key={entry.run.id}>
                {index > 0 ? <View style={styles.separator} /> : null}
                <RunRow entry={entry} onAnswer={onAnswer} />
              </Fragment>
            ))}
          </View>
        )}
      </View>
    </View>
  )
}
