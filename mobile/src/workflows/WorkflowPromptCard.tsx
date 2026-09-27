import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { agentQuestionContext } from '../../../src/shared/workflows/workflow-agent-question-subject'
import {
  APPROVAL_DEFAULT_ANSWERER,
  approvalQuestionSubject
} from '../../../src/shared/workflows/workflow-approval-question-subject'
import type { RunQuestionView } from '../../../src/shared/workflows/workflow-run-types'
import { trustQuestionSubject } from '../../../src/shared/workflows/workflow-trust-question-subject'
import { colors } from '../theme/mobile-theme'
import {
  isAnswerableWorkflowQuestion,
  isKnownWorkflowQuestion,
  type MobileWorkflowQuestion
} from './workflow-run-reply-schema'
import type { WorkflowAnswerOutcome, WorkflowQuestionAnswer } from './workflow-run-operations'
import { workflowStyles as styles } from './workflow-run-styles'

export type WorkflowPromptCardProps = {
  question: MobileWorkflowQuestion
  onAnswer: (answer: WorkflowQuestionAnswer) => Promise<WorkflowAnswerOutcome>
  /** `questionExpiryReason` for an expired question: any reason reads "Closed", none "Timed out". */
  expiredReason?: string
}

type Submission = {
  sending: WorkflowQuestionAnswer | undefined
  outcome: WorkflowAnswerOutcome | undefined
  /** Nothing more can be sent from this card: the answer landed, or the host can't take one. */
  locked: boolean
  submit: (answer: WorkflowQuestionAnswer) => Promise<WorkflowAnswerOutcome | undefined>
}

function useSubmission(onAnswer: WorkflowPromptCardProps['onAnswer']): Submission {
  const [sending, setSending] = useState<WorkflowQuestionAnswer | undefined>()
  const [outcome, setOutcome] = useState<WorkflowAnswerOutcome | undefined>()
  const locked = outcome !== undefined && outcome.kind !== 'error'
  async function submit(answer: WorkflowQuestionAnswer) {
    if (sending || locked) {
      return undefined
    }
    setSending(answer)
    setOutcome(undefined)
    const result = await onAnswer(answer)
    setOutcome(result)
    setSending(undefined)
    return result
  }
  return { sending, outcome, locked, submit }
}

function OutcomeNotice({ outcome }: { outcome: WorkflowAnswerOutcome | undefined }) {
  switch (outcome?.kind) {
    case undefined:
      return null
    case 'answered':
      return <Text style={styles.meta}>Answer sent.</Text>
    case 'unsupported':
      return <Text style={styles.meta}>Answering isn't available on this host yet.</Text>
    case 'not-pending':
      return <Text style={styles.meta}>Already answered or closed.</Text>
    case 'error':
      return <Text style={styles.errorText}>{outcome.message}</Text>
  }
}

function ActionButton({
  label,
  busy,
  disabled,
  onPress
}: {
  label: string
  busy: boolean
  disabled: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  )
}

function CardHeader({ title, escalated }: { title: string; escalated: boolean }) {
  return (
    <View style={styles.cardHeader}>
      <Text style={styles.cardTitle}>{title}</Text>
      {escalated ? <Text style={styles.badge}>Escalated</Text> : null}
    </View>
  )
}

/** FR-033: one action per Approval option, answered by `optionId`. */
function ApprovalPrompt({
  question,
  onAnswer
}: {
  question: RunQuestionView
  onAnswer: WorkflowPromptCardProps['onAnswer']
}) {
  const submission = useSubmission(onAnswer)
  const subject = approvalQuestionSubject(question)
  if (!subject) {
    return <PromptOnly prompt={question.prompt} />
  }
  return (
    <View style={styles.card}>
      <CardHeader title="Approval needed" escalated={question.state === 'escalated'} />
      <Text style={styles.prompt}>{question.prompt}</Text>
      {subject.defaultOption ? (
        <Text style={styles.meta}>{`Default on timeout: ${subject.defaultOption}`}</Text>
      ) : null}
      <OutcomeNotice outcome={submission.outcome} />
      <View style={styles.actions}>
        {subject.options.map((option) => (
          <ActionButton
            key={option}
            label={option}
            busy={
              submission.sending !== undefined &&
              'optionId' in submission.sending &&
              submission.sending.optionId === option
            }
            disabled={submission.sending !== undefined || submission.locked}
            onPress={() => void submission.submit({ optionId: option })}
          />
        ))}
      </View>
    </View>
  )
}

/** FR-033a: a free-text answer delivered back to the asking agent's session. */
function AgentQuestionPrompt({
  question,
  onAnswer
}: {
  question: RunQuestionView
  onAnswer: WorkflowPromptCardProps['onAnswer']
}) {
  const submission = useSubmission(onAnswer)
  const [draft, setDraft] = useState('')
  const context = agentQuestionContext(question)
  const trimmed = draft.trim()
  const blocked = submission.sending !== undefined || submission.locked
  async function send() {
    const result = await submission.submit({ answer: trimmed })
    if (result?.kind === 'answered') {
      setDraft('')
    }
  }
  return (
    <View style={styles.card}>
      <CardHeader title="The agent has a question" escalated={question.state === 'escalated'} />
      <Text style={styles.prompt}>{question.prompt}</Text>
      {context ? <Text style={styles.context}>{context}</Text> : null}
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        placeholder="Type your answer…"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Your answer"
        editable={!blocked}
        multiline
      />
      <OutcomeNotice outcome={submission.outcome} />
      <View style={styles.actions}>
        <ActionButton
          label="Answer"
          busy={submission.sending !== undefined}
          disabled={blocked || trimmed.length === 0}
          onPress={() => void send()}
        />
      </View>
    </View>
  )
}

/** FR-018a: trust is reviewed with the skill and agent lists on desktop, so mobile only shows it. */
function TrustNotice({ question }: { question: RunQuestionView }) {
  const subject = trustQuestionSubject(question)
  return (
    <View style={styles.card}>
      <CardHeader title="Trust required" escalated={question.state === 'escalated'} />
      <Text style={styles.prompt}>{question.prompt}</Text>
      {subject ? <Text style={styles.meta}>{`${subject.source} on ${subject.host}`}</Text> : null}
      <Text style={styles.meta}>Review this on the desktop app.</Text>
    </View>
  )
}

function PromptOnly({ prompt }: { prompt: string }) {
  return (
    <View style={styles.card}>
      <CardHeader title="Waiting on you" escalated={false} />
      <Text style={styles.prompt}>{prompt}</Text>
      <Text style={styles.meta}>Answer this on the desktop app.</Text>
    </View>
  )
}

function answerLabel(question: RunQuestionView): string | undefined {
  if (question.kind !== 'trust') {
    return question.answer
  }
  return question.answer === 'trusted'
    ? 'Trusted'
    : question.answer === 'refused'
      ? 'Refused'
      : question.answer
}

/** An answered or expired question: the answer and who gave it, or that it closed unanswered. */
function SettledSummary({
  question,
  expiredReason
}: {
  question: RunQuestionView
  expiredReason: string | undefined
}) {
  const answer = answerLabel(question)
  const when = question.answeredAt ? ` at ${new Date(question.answeredAt).toLocaleString()}` : ''
  return (
    <View style={styles.card}>
      <Text style={styles.meta}>{question.prompt}</Text>
      {answer ? (
        <Text style={styles.prompt}>{answer}</Text>
      ) : (
        <Text style={styles.meta}>
          {expiredReason ? 'Closed with no answer.' : 'Timed out with no answer.'}
        </Text>
      )}
      {question.answeredBy === APPROVAL_DEFAULT_ANSWERER ? (
        <Text style={styles.meta}>{`Default applied after timeout${when}`}</Text>
      ) : question.answeredBy ? (
        <Text style={styles.meta}>{`Answered by ${question.answeredBy}${when}`}</Text>
      ) : null}
    </View>
  )
}

/** One workflow question, switched by kind: approvals and agent questions are answerable here,
 *  trust and unknown kinds are shown read-only, settled questions show their outcome. */
export function WorkflowPromptCard({ question, onAnswer, expiredReason }: WorkflowPromptCardProps) {
  if (!isKnownWorkflowQuestion(question)) {
    return <PromptOnly prompt={question.prompt} />
  }
  if (!isAnswerableWorkflowQuestion(question)) {
    return <SettledSummary question={question} expiredReason={expiredReason} />
  }
  switch (question.kind) {
    case 'approval':
      return <ApprovalPrompt question={question} onAnswer={onAnswer} />
    case 'agent-question':
      return <AgentQuestionPrompt question={question} onAnswer={onAnswer} />
    case 'trust':
      return <TrustNotice question={question} />
  }
}
