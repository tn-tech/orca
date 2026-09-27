// The one-off planner workflow `workflow.draft` runs (US6): Start -> one Agent node -> End, whose
// result contract is the workflow definition schema itself, so the engine's own brief and
// result capture carry the drafted definition back.
import { z } from 'zod'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { Repo } from '../../../shared/repo-types'
import { isFolderRepo } from '../../../shared/repo-kind'
import type { TuiAgent } from '../../../shared/tui-agent'
import { isTuiAgentEnabled, TUI_AGENT_AUTO_PICK_ORDER } from '../../../shared/tui-agent-selection'
import { WorkflowFileSchema } from '../../../shared/workflows/workflow-definition-schema'
import type { ResultContract, Workflow } from '../../../shared/workflows/workflow-definition-types'
import { ResultContractSchema } from '../../../shared/workflows/workflow-node-schemas'
import { OrchestrationError } from '../orchestration/orchestration-error'

export const DRAFT_PLANNER_NODE_ID = 'plan'
/** Display name only: a user's definition may carry any `name`, so it identifies nothing. */
export const DRAFT_PLANNER_WORKFLOW_NAME = 'orca/workflow-draft'
/**
 * What marks a planner run. Every other run records its file's sha256 `revision` as its version,
 * so no user workflow can produce this value; only `workflow.draft` ever sets it.
 */
export const DRAFT_PLANNER_RUN_VERSION = 'orca:draft-planner'
const DRAFT_PLANNER_ROLE_ID = 'planner'
const DRAFT_PLANNER_QUESTION = { timeoutMs: 600_000, escalationGraceMs: 300_000 }
/** Strictly inside the planner's question window: the draft request gives up (and tears the
 *  planner down) before an unanswered question could expire on its own. */
export const DRAFT_DEADLINE_MS =
  DRAFT_PLANNER_QUESTION.timeoutMs + DRAFT_PLANNER_QUESTION.escalationGraceMs - 60_000

export function isDraftPlannerRun(run: { workflowVersion: string }): boolean {
  return run.workflowVersion === DRAFT_PLANNER_RUN_VERSION
}

/** The planner setting, then the default agent, then the app's auto-pick order; disabled agents never plan. */
export function resolveWorkflowPlannerAgent(
  settings:
    | Partial<
        Pick<GlobalSettings, 'workflowPlannerAgent' | 'defaultTuiAgent' | 'disabledTuiAgents'>
      >
    | undefined
): string {
  const defaultAgent = settings?.defaultTuiAgent === 'blank' ? null : settings?.defaultTuiAgent
  const candidates = [settings?.workflowPlannerAgent, defaultAgent, ...TUI_AGENT_AUTO_PICK_ORDER]
  const agent = candidates.find(
    (candidate): candidate is TuiAgent =>
      !!candidate && isTuiAgentEnabled(candidate, settings?.disabledTuiAgents)
  )
  if (!agent) {
    throw new OrchestrationError(
      'agent_unconfigured',
      'Every agent is disabled; enable one in Settings to draft a workflow.'
    )
  }
  return agent
}

let cachedResultContract: ResultContract | undefined

/** The file-shaped definition schema (roles keyed by id, no `id` field) as JSON Schema. */
export function workflowDefinitionResultContract(): ResultContract {
  cachedResultContract ??= ResultContractSchema.parse(
    z.toJSONSchema(WorkflowFileSchema, { io: 'input', unrepresentable: 'any' })
  )
  return cachedResultContract
}

/** Folder workspaces have no worktree to place a run in, so they draft (and run) in place. */
export function draftWorkspacePolicy(repo: Pick<Repo, 'kind'>): Workflow['workspacePolicy'] {
  return isFolderRepo(repo) ? 'in-place' : 'run-workspace'
}

function plannerSystemPrompt(plannerAgent: string, policy: Workflow['workspacePolicy']): string {
  return [
    'You are the workflow planner for Orca visual DAG workflows.',
    'Design a workflow that accomplishes the objective, and write its complete definition as your',
    'result JSON. The result must match the result contract exactly: it is the workflow file format.',
    'Rules:',
    '- Exactly one `start` node and one `end` node; every node reachable from Start.',
    '- Every agent, router and reflection node sets `roleId` (a key of `roles`) or `overrides.agent`.',
    `- Role agents are Orca agent ids; use "${plannerAgent}" unless the objective needs another.`,
    '- No cycles, except through a `loop` node with a `maxIterations` cap.',
    '- Every agent node has a `resultContract` JSON Schema whose root is `{ "type": "object" }`.',
    `- Use \`workspacePolicy: "${policy}"\` and \`workspace: "run"\` on agent nodes.`,
    '- Put an `{ x, y }` entry in `layout` for every node id, left to right in run order.',
    'You may read the repository for context. Do not modify any repository file.'
  ].join('\n')
}

/** The planner run's own definition; `repo` decides only its workspace policy. */
export function buildDraftPlannerWorkflow(
  repo: Pick<Repo, 'kind'>,
  plannerAgent: string
): Workflow {
  const policy = draftWorkspacePolicy(repo)
  return {
    version: 1,
    name: DRAFT_PLANNER_WORKFLOW_NAME,
    description: 'Drafts a workflow definition from an objective.',
    workspacePolicy: policy,
    roles: {
      [DRAFT_PLANNER_ROLE_ID]: {
        id: DRAFT_PLANNER_ROLE_ID,
        name: 'Workflow planner',
        agent: plannerAgent,
        systemPrompt: plannerSystemPrompt(plannerAgent, policy),
        skills: []
      }
    },
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      {
        id: DRAFT_PLANNER_NODE_ID,
        type: 'agent',
        title: 'Draft workflow',
        roleId: DRAFT_PLANNER_ROLE_ID,
        prompt: 'Draft a workflow for this objective:\n\n${objective}',
        workspace: 'run',
        resultContract: workflowDefinitionResultContract(),
        artifacts: [],
        question: DRAFT_PLANNER_QUESTION
      },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [
      { id: 'start-plan', from: 'start', to: DRAFT_PLANNER_NODE_ID },
      { id: 'plan-end', from: DRAFT_PLANNER_NODE_ID, to: 'end' }
    ],
    layout: {}
  }
}
