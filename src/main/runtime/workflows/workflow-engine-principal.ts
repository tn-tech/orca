export type WorkflowEnginePrincipal = {
  kind: 'workflow-engine'
  workflowRunId: string
  // Why: the engine has no terminal, so worker placement cannot be derived from `--from`.
  worktreeId?: string
}

export type OrchestrationPrincipal = { kind: 'terminal'; handle: string } | WorkflowEnginePrincipal

const ENGINE_COORDINATOR_PREFIX = 'workflow-engine:'

export function engineCoordinatorHandle(workflowRunId: string): string {
  return `${ENGINE_COORDINATOR_PREFIX}${workflowRunId}`
}

// Why: no `:<uuid>` leaf, so isEquivalentPaneKey only ever matches it exactly — never a live pane.
export function engineCoordinatorPaneKey(workflowRunId: string): string {
  return `${ENGINE_COORDINATOR_PREFIX}${workflowRunId}`
}

export function asWorkflowEnginePrincipal(
  principal: OrchestrationPrincipal | undefined
): WorkflowEnginePrincipal | undefined {
  return principal?.kind === 'workflow-engine' ? principal : undefined
}
