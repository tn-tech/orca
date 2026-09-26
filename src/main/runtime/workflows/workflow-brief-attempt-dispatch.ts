// Hands a brief node's attempt to the worker: provisions its skills while `provisioning`, then
// starts the worker (workflow-node-dispatch.ts). A first launch and a resumed trust wait
// (workflow-trust-wait.ts) both come through here, so they cannot diverge.
import type { SkillReference, Workflow } from '../../../shared/workflows/workflow-definition-types'
import { childWorkspaceRepositorySkillsMessage } from '../../../shared/workflows/workflow-graph-validation'
import type { BriefNode } from './workflow-brief-builder'
import { dispatchWorkflowNode } from './workflow-node-dispatch'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'
import type { WorkflowSkillProvisioningOutcome } from './workflow-skill-provisioning'
import { createRunSkillProvisioner } from './workflow-skill-provisioning-host'
import { enterTrustWait } from './workflow-trust-wait'

/** Node skills replace the role's list as a whole, matching the brief (FR-017). */
export function nodeSkills(node: BriefNode, roles: Workflow['roles']): SkillReference[] {
  const role = node.roleId === undefined ? undefined : roles[node.roleId]
  return node.overrides?.skills ?? role?.skills ?? []
}

export async function provisionNodeSkillsFor(
  ctx: WorkflowNodeLaunchContext,
  node: BriefNode,
  attemptId: string,
  agent: string
): Promise<WorkflowSkillProvisioningOutcome> {
  const skills = nodeSkills(node, ctx.definition.roles)
  // Worker-start creates the child worktree, so there is nothing to install into beforehand.
  const needsRepositorySkills = skills.some((skill) => skill.source.kind === 'repository')
  if (node.type === 'agent' && node.workspace === 'child' && needsRepositorySkills) {
    return { kind: 'failed', reason: childWorkspaceRepositorySkillsMessage(node.id) }
  }
  const outcome = await createRunSkillProvisioner(ctx.workspace, ctx.db).provision({
    runId: ctx.recorder.runId,
    agent,
    skills
  })
  if (outcome.kind === 'ready' && (outcome.installed.length > 0 || outcome.promptFallback)) {
    ctx.recorder.event(
      'skills_provisioned',
      {
        nodeId: node.id,
        installed: outcome.installed,
        promptFallback: outcome.promptFallback?.skills.map((skill) => skill.name) ?? []
      },
      { attemptId, reason: 'attempt' }
    )
  }
  return outcome
}

export async function dispatchBriefAttempt(
  ctx: WorkflowNodeLaunchContext,
  node: BriefNode,
  attemptId: string,
  taskId: string
): Promise<void> {
  const outcome = await dispatchWorkflowNode({
    port: ctx.client,
    attemptStore: ctx.recorder.dispatchStore(),
    runId: ctx.recorder.runId,
    attemptId,
    taskId,
    node,
    roles: ctx.definition.roles,
    workspacePolicy: ctx.definition.workspacePolicy,
    provisionSkills: (agent) => provisionNodeSkillsFor(ctx, node, attemptId, agent),
    onTrustRequired: (question) => enterTrustWait(ctx.db, ctx.recorder, attemptId, question)
  })
  const dispatchId = outcome.attempt?.dispatchId
  if (outcome.ok && dispatchId) {
    ctx.db.updateWorkflowAttempt(attemptId, {
      transcriptRef: { kind: 'dispatch', id: dispatchId }
    })
  }
}
