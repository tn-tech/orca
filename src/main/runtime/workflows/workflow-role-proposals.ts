// Acting on a Reflection's role proposals (US7 AS2/AS3, FR-034): accept one into the workflow file
// through the shared save gate, or export it as a change bundle toward the role's origin repository.
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowProblem } from '../../../shared/workflows/workflow-problem'
import type {
  RoleProposalState,
  RoleProposalView,
  RunSnapshot
} from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { joinWorktreeRelativePath } from '../runtime-relative-paths'
import type { WorkflowFilesystem } from './workflow-file-store-filesystem'
import { assertValidRoleName } from './workflow-role-import'
import { acceptedRole, roleChangedSinceRun } from './workflow-role-proposal-apply'
import { buildRoleProposalBundle } from './workflow-role-proposal-bundle'
import { WorkflowRunRecorder, type WorkflowRunChangeNotifier } from './workflow-run-recorder'

type RoleProposalPorts = { db: OrchestrationDb; notifier: WorkflowRunChangeNotifier }

export type RoleProposalAcceptPorts = RoleProposalPorts & {
  /** The run's workflow file as it is now. */
  readWorkflowFile(
    run: RunSnapshot
  ): Promise<{ definition: Workflow | undefined; revision: string; problems: WorkflowProblem[] }>
  /** The shared validate-and-write gate; refuses a stale `expectedRevision`. */
  saveWorkflowFile(
    run: RunSnapshot,
    definition: Workflow,
    expectedRevision: string
  ): Promise<{ revision: string }>
}

export type RoleProposalExportPorts = RoleProposalPorts & {
  /** The run's workspace on its execution host; no local fallback for a remote one. */
  resolveWorkspace(run: RunSnapshot): Promise<{ workspaceRoot: string; fs: WorkflowFilesystem }>
}

export type RoleProposalAction = { runId: string; proposalId: string; actor: string }

const ACCEPTABLE_STATES: readonly RoleProposalState[] = ['proposed', 'exported']
const EXPORTABLE_STATES: readonly RoleProposalState[] = ['proposed', 'exported', 'accepted']

function requireProposal(
  db: OrchestrationDb,
  action: RoleProposalAction,
  allowedStates: readonly RoleProposalState[]
): { run: RunSnapshot; proposal: RoleProposalView } {
  const run = db.getWorkflowRun(action.runId)
  if (!run) {
    throw new Error('workflow_not_found')
  }
  const proposal = db.getWorkflowRoleProposal(action.proposalId)
  if (!proposal || proposal.runId !== run.id) {
    throw new OrchestrationError(
      'workflow_proposal_not_found',
      `Proposal ${action.proposalId} was not found on workflow run ${run.id}.`,
      { runId: run.id, proposalId: action.proposalId }
    )
  }
  if (!allowedStates.includes(proposal.state)) {
    throw new OrchestrationError(
      'workflow_proposal_not_pending',
      `Proposal ${proposal.id} is already ${proposal.state}.`,
      { runId: run.id, proposalId: proposal.id, state: proposal.state }
    )
  }
  return { run, proposal }
}

function roleNotFound(run: RunSnapshot, roleId: string): OrchestrationError {
  return new OrchestrationError(
    'workflow_role_not_found',
    `Role ${roleId} is not in workflow ${run.workflowName}.`,
    { runId: run.id, roleId }
  )
}

/**
 * Replaces the proposed fields of the role in the run's workflow file and records the change on
 * the run that produced it. Refuses (`workflow_file_conflict`) when those fields were edited in
 * the file since that run, so a proposal never overwrites a change it did not see.
 */
export async function acceptRoleProposal(
  ports: RoleProposalAcceptPorts,
  action: RoleProposalAction
): Promise<{ revision: string }> {
  const { run, proposal } = requireProposal(ports.db, action, ACCEPTABLE_STATES)
  const current = await ports.readWorkflowFile(run)
  if (!current.definition) {
    throw new OrchestrationError('workflow_invalid', 'workflow_invalid', {
      problems: current.problems
    })
  }
  const role = current.definition.roles[proposal.roleId]
  if (!role) {
    throw roleNotFound(run, proposal.roleId)
  }
  if (roleChangedSinceRun(run.workflowSnapshot.roles[proposal.roleId], role, proposal.change)) {
    throw new Error('workflow_file_conflict')
  }
  const definition: Workflow = {
    ...current.definition,
    roles: { ...current.definition.roles, [proposal.roleId]: acceptedRole(role, proposal.change) }
  }
  const { revision } = await ports.saveWorkflowFile(run, definition, current.revision)
  ports.db.transitionWorkflowRoleProposal(proposal.id, 'accepted', ACCEPTABLE_STATES)
  new WorkflowRunRecorder(ports.db, ports.notifier, run.id).event(
    'role_proposal_accepted',
    { proposalId: proposal.id, roleId: proposal.roleId, revision, acceptedBy: action.actor },
    { attemptId: proposal.attemptId }
  )
  return { revision }
}

/**
 * Writes `<roleId>.patch` and `<roleId>.README.md` under the run's
 * `.orca/workflow-runs/<runId>/proposals/` on its execution host. An accepted proposal stays
 * `accepted`; otherwise it becomes `exported`.
 */
export async function exportRoleProposal(
  ports: RoleProposalExportPorts,
  action: RoleProposalAction
): Promise<{ exportPath: string }> {
  const { run, proposal } = requireProposal(ports.db, action, EXPORTABLE_STATES)
  const role = run.workflowSnapshot.roles[proposal.roleId]
  if (!role) {
    throw roleNotFound(run, proposal.roleId)
  }
  if (!role.origin) {
    throw new OrchestrationError(
      'workflow_role_not_imported',
      `Role ${proposal.roleId} was not imported from a role repository, so it has no origin to export to.`,
      { runId: run.id, roleId: proposal.roleId }
    )
  }
  // The role id names the exported files, and an imported role's id is its origin role name.
  assertValidRoleName(proposal.roleId)
  const bundle = buildRoleProposalBundle({
    workflowName: run.workflowName,
    runId: run.id,
    role,
    origin: role.origin,
    proposal
  })
  const dir = `.orca/workflow-runs/${run.id}/proposals`
  const exportPath = `${dir}/${proposal.roleId}.patch`
  const { workspaceRoot, fs } = await ports.resolveWorkspace(run)
  await fs.createDir(joinWorktreeRelativePath(workspaceRoot, dir))
  await fs.writeFile(joinWorktreeRelativePath(workspaceRoot, exportPath), bundle.patch)
  await fs.writeFile(
    joinWorktreeRelativePath(workspaceRoot, `${dir}/${proposal.roleId}.README.md`),
    bundle.readme
  )
  ports.db.transitionWorkflowRoleProposal(proposal.id, 'exported', ['proposed', 'exported'])
  new WorkflowRunRecorder(ports.db, ports.notifier, run.id).event(
    'role_proposal_exported',
    { proposalId: proposal.id, roleId: proposal.roleId, exportPath, exportedBy: action.actor },
    { attemptId: proposal.attemptId }
  )
  return { exportPath }
}
