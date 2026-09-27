import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { RoleProposalInput } from '../../../shared/workflows/workflow-role-proposal-schema'
import type { RoleProposalView } from '../../../shared/workflows/workflow-run-types'
import { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from '../orchestration/db'
import type { RpcRequest } from '../rpc/core'
import { RpcDispatcher } from '../rpc/dispatcher'
import { WORKFLOW_METHODS } from '../rpc/methods/workflows'
import { serializeWorkflowFile } from '../rpc/methods/workflows/workflow-file-serialization'
import { readWorkflow, writeWorkflow } from './workflow-file-store'
import { joinDriver } from './workflow-run-controller-join-fixtures'
import { createControllerHarness, RUN_WORKTREE_ID } from './workflow-run-controller-test-harness'
import { WorkflowRunRecorder } from './workflow-run-recorder'
import { applyImportedRole } from './workflow-role-import-merge'
import {
  importedDeveloper,
  reflectionWorkflow,
  ROLE_ORIGIN_SOURCE,
  writeProjectWorkflow
} from './workflow-role-proposal-test-fixtures'

const SHARPER_PROMPT = 'Implement it. Run the tests before reporting.'
const PROPOSALS: RoleProposalInput[] = [
  {
    roleId: 'developer',
    change: { systemPrompt: SHARPER_PROMPT },
    evidence: 'implement reported success without running the tests.'
  },
  {
    roleId: 'coach',
    change: { skills: [{ name: 'deck-review', source: { kind: 'plugin', plugin: 'consulting' } }] },
    evidence: 'The review had no checklist to follow.'
  }
]

describe('Reflection nodes', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof joinDriver>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-reflection-'))
    h = createControllerHarness(workspaceRoot)
    d = joinDriver(h)
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    h.db.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it('briefs the Reflection with the run record and stores each proposal with its evidence', async () => {
    const run = h.createRun(reflectionWorkflow())
    const finished = h.createController(run.id).run()
    const implement = await d.report(run.id, 'implement', 'succeeded')
    await d.reached(run.id, 'reflect', ['running'])
    const reflect = d.attempt(run.id, 'reflect')
    const briefPath = reflect?.briefPath ?? ''
    const brief = await readFile(join(workspaceRoot, briefPath), 'utf-8')
    expect(brief).toContain(implement.resultPath)
    expect(brief).toContain(implement.briefPath)
    expect(brief).toContain(`orchestration worker-read --dispatch ${implement.dispatchId}`)
    const inputs = JSON.parse(
      await readFile(join(workspaceRoot, dirname(briefPath), 'inputs.json'), 'utf-8')
    )
    expect(inputs.runRecord).toEqual([
      expect.objectContaining({
        nodeId: 'implement',
        state: 'completed',
        resultPath: implement.resultPath,
        transcript: { dispatchId: implement.dispatchId }
      })
    ])

    await d.report(run.id, 'reflect', 'succeeded', { proposals: PROPOSALS })
    await expect(finished).resolves.toBe('completed')

    const proposals = h.db.listWorkflowRoleProposals(run.id)
    expect(proposals).toEqual([
      expect.objectContaining({
        runId: run.id,
        attemptId: reflect?.id,
        roleId: 'developer',
        change: { systemPrompt: SHARPER_PROMPT },
        evidence: PROPOSALS[0].evidence,
        state: 'proposed'
      }),
      expect.objectContaining({
        roleId: 'coach',
        change: {
          skills: [
            {
              name: 'deck-review',
              source: { kind: 'plugin', plugin: 'consulting' },
              required: true
            }
          ]
        },
        evidence: PROPOSALS[1].evidence,
        state: 'proposed'
      })
    ])
    const recorded = h.db
      .listWorkflowEvents(run.id, 0)
      .filter((event) => event.kind === 'role_proposals_recorded')
    expect(recorded).toEqual([
      expect.objectContaining({
        attemptId: reflect?.id,
        payloadJson: { proposalIds: proposals.map((proposal) => proposal.id) }
      })
    ])
  })

  it('fails a Reflection that proposes a change to a role the workflow does not have', async () => {
    const run = h.createRun(reflectionWorkflow())
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'implement', 'succeeded')
    await d.report(run.id, 'reflect', 'succeeded', {
      proposals: [{ roleId: 'ghost', change: { systemPrompt: 'Boo.' }, evidence: 'None.' }]
    })
    await expect(finished).resolves.toBe('failed')
    expect(d.attempt(run.id, 'reflect')).toMatchObject({
      state: 'failed',
      failureReason: 'result_invalid'
    })
    expect(h.db.listWorkflowRoleProposals(run.id)).toEqual([])
  })

  it('fails a Reflection whose proposal changes nothing', async () => {
    const run = h.createRun(reflectionWorkflow())
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'implement', 'succeeded')
    await d.report(run.id, 'reflect', 'succeeded', {
      proposals: [{ roleId: 'developer', change: {}, evidence: 'Nothing to change.' }]
    })
    await expect(finished).resolves.toBe('failed')
    expect(d.attempt(run.id, 'reflect')?.failureReason).toBe('result_invalid')
  })

  it('records a replayed report for the same attempt only once', () => {
    const run = h.createRun(reflectionWorkflow())
    const first = h.db.recordWorkflowRoleProposals(run.id, 'wfa_1', PROPOSALS.slice(0, 1))
    const replay = h.db.recordWorkflowRoleProposals(run.id, 'wfa_1', PROPOSALS.slice(0, 1))
    expect(replay).toEqual(first)
    expect(h.db.listWorkflowRoleProposals(run.id)).toHaveLength(1)
  })
})

// A WebSocket caller's clientId is its device bearer token (runtime-rpc-websocket-dispatch.ts).
const SECRET_TOKEN = 'dvc_tok_5f0c9a7e3b1d4e2f8a6c0b9d7e5f3a1c'
const PHONE = {
  clientId: SECRET_TOKEN,
  pairedDeviceId: 'device_phone_1',
  clientKind: 'mobile' as const
}

let sequence = 0
function request(method: string, params: unknown): RpcRequest {
  sequence += 1
  return { id: `req-${sequence}`, authToken: 'tok', method, params }
}

type Reply = { ok?: boolean; result?: Record<string, unknown>; error?: { code?: string } }

describe('workflow.proposal.accept / workflow.proposal.export', () => {
  let root: string
  let runWorkspace: string
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let dispatcher: RpcDispatcher

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'workflow-proposals-'))
    runWorkspace = join(root, 'run-workspace')
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    dispatcher = new RpcDispatcher({ runtime, methods: WORKFLOW_METHODS })
    vi.spyOn(runtime, 'showManagedWorktree').mockImplementation(async (selector) => {
      if (selector !== `id:${RUN_WORKTREE_ID}`) {
        throw new Error('selector_not_found')
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: export reads only the worktree's id and path.
      return { id: RUN_WORKTREE_ID, path: runWorkspace } as Awaited<
        ReturnType<OrcaRuntimeService['showManagedWorktree']>
      >
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  /** A completed run of `definition` whose Reflection proposed `proposals`. */
  async function reflectedRun(
    definition: Workflow = reflectionWorkflow(),
    proposals = PROPOSALS,
    repoOverride?: Partial<Repo>
  ): Promise<{ repo: Repo; runId: string; proposals: RoleProposalView[] }> {
    const local = await writeProjectWorkflow(root, definition)
    const { revision } = await readWorkflow(local, 'project', definition.name)
    const repo = { ...local, ...repoOverride }
    vi.spyOn(runtime, 'showRepo').mockResolvedValue(repo)
    const run = db.createWorkflowRun({
      workflowName: definition.name,
      workflowSource: 'project',
      workflowSnapshot: definition,
      workflowVersion: revision,
      objective: 'add a greeting',
      repoId: repo.id,
      worktreeId: RUN_WORKTREE_ID
    })
    const recorder = new WorkflowRunRecorder(db, runtime, run.id)
    const attempt = recorder.createAttempt({ id: 'reflect', type: 'reflection' })
    return {
      repo,
      runId: run.id,
      proposals: db.recordWorkflowRoleProposals(run.id, attempt.id, proposals)
    }
  }

  async function call(method: string, params: unknown): Promise<Reply> {
    let reply: Reply = {}
    await dispatcher.dispatchStreaming(
      request(method, params),
      (raw) => (reply = JSON.parse(raw)),
      PHONE
    )
    return reply
  }

  async function fileRole(repo: Repo, roleId: string) {
    return (await readWorkflow(repo, 'project', 'reflective')).definition?.roles[roleId]
  }

  describe('accept', () => {
    it('updates the role in the workflow file and records the change on the run', async () => {
      const { repo, runId, proposals } = await reflectedRun()
      const reply = await call('workflow.proposal.accept', { runId, proposalId: proposals[0].id })

      const file = await readWorkflow(repo, 'project', 'reflective')
      expect(reply).toMatchObject({ ok: true, result: { revision: file.revision } })
      expect(file.definition?.roles.developer.systemPrompt).toBe(SHARPER_PROMPT)
      expect(db.getWorkflowRoleProposal(proposals[0].id)?.state).toBe('accepted')
      const events = db.listWorkflowEvents(runId, 0)
      expect(events.find((event) => event.kind === 'role_proposal_accepted')).toMatchObject({
        attemptId: proposals[0].attemptId,
        payloadJson: {
          proposalId: proposals[0].id,
          roleId: 'developer',
          revision: file.revision,
          acceptedBy: 'device_phone_1'
        }
      })
      expect(JSON.stringify(events)).not.toContain(SECRET_TOKEN)
    })

    it('marks an accepted imported role locally modified while keeping its origin', async () => {
      const imported = importedDeveloper()
      const { repo, runId, proposals } = await reflectedRun(reflectionWorkflow(imported))
      await call('workflow.proposal.accept', { runId, proposalId: proposals[0].id })

      const role = await fileRole(repo, 'developer')
      expect(role?.origin).toEqual({ ...imported.origin, localModified: true })
      // A later re-import from the origin keeps the accepted change rather than overwriting it.
      const { id: _id, origin: _origin, ...upstream } = imported
      const reimport = applyImportedRole(role, {
        roleId: 'developer',
        source: ROLE_ORIGIN_SOURCE,
        version: 'fedcba9876543210',
        importedAt: '2026-09-20T00:00:00.000Z',
        content: upstream
      })
      expect(reimport.role.systemPrompt).toBe(SHARPER_PROMPT)
      expect(reimport.availableVersion).toBe('fedcba9876543210')
    })

    it('refuses when the role changed in the file since the run', async () => {
      const { repo, runId, proposals } = await reflectedRun()
      const edited = reflectionWorkflow({
        ...reflectionWorkflow().roles.developer,
        systemPrompt: 'Edited by hand.'
      })
      const { revision } = await readWorkflow(repo, 'project', 'reflective')
      await writeWorkflow(repo, 'project', 'reflective', serializeWorkflowFile(edited), revision)

      const reply = await call('workflow.proposal.accept', { runId, proposalId: proposals[0].id })
      expect(reply).toMatchObject({ ok: false, error: { code: 'workflow_file_conflict' } })
      expect((await fileRole(repo, 'developer'))?.systemPrompt).toBe('Edited by hand.')
      expect(db.getWorkflowRoleProposal(proposals[0].id)?.state).toBe('proposed')
    })

    it('refuses a skill from a repository the project does not allow, through the save gate', async () => {
      const { repo, runId, proposals } = await reflectedRun(reflectionWorkflow(), [
        {
          roleId: 'developer',
          change: {
            skills: [
              { name: 'lint', source: { kind: 'repository', location: 'https://evil.test/x' } }
            ]
          },
          evidence: 'No linting happened.'
        }
      ])
      const reply = await call('workflow.proposal.accept', { runId, proposalId: proposals[0].id })
      expect(reply).toMatchObject({ ok: false, error: { code: 'workflow_source_not_allowed' } })
      expect((await fileRole(repo, 'developer'))?.skills).toEqual([])
      expect(db.getWorkflowRoleProposal(proposals[0].id)?.state).toBe('proposed')
    })

    it('refuses a proposal that is already accepted, or that belongs to another run', async () => {
      const { runId, proposals } = await reflectedRun()
      await call('workflow.proposal.accept', { runId, proposalId: proposals[0].id })
      expect(
        await call('workflow.proposal.accept', { runId, proposalId: proposals[0].id })
      ).toMatchObject({ ok: false, error: { code: 'workflow_proposal_not_pending' } })
      const other = db.createWorkflowRun({
        workflowName: 'reflective',
        workflowSource: 'project',
        workflowSnapshot: reflectionWorkflow(),
        workflowVersion: 'v1',
        objective: 'x',
        repoId: 'repo',
        worktreeId: RUN_WORKTREE_ID
      })
      expect(
        await call('workflow.proposal.accept', { runId: other.id, proposalId: proposals[1].id })
      ).toMatchObject({ ok: false, error: { code: 'workflow_proposal_not_found' } })
      expect(
        await call('workflow.proposal.accept', {
          runId: 'wfr_missing',
          proposalId: proposals[1].id
        })
      ).toMatchObject({ ok: false, error: { code: 'workflow_not_found' } })
      expect(db.getWorkflowRoleProposal(proposals[1].id)?.state).toBe('proposed')
    })
  })

  describe('export', () => {
    const exportDir = (runId: string) =>
      join(runWorkspace, '.orca', 'workflow-runs', runId, 'proposals')

    it('writes a change bundle for the origin repository and marks the proposal exported', async () => {
      const imported = importedDeveloper()
      const { runId, proposals } = await reflectedRun(reflectionWorkflow(imported))
      const reply = await call('workflow.proposal.export', { runId, proposalId: proposals[0].id })

      const exportPath = `.orca/workflow-runs/${runId}/proposals/developer.patch`
      expect(reply).toMatchObject({ ok: true, result: { exportPath } })
      const patch = await readFile(join(runWorkspace, exportPath), 'utf-8')
      expect(patch).toContain('--- a/roles/developer.role.yaml')
      expect(patch).toContain('+++ b/roles/developer.role.yaml')
      expect(patch).toContain('-systemPrompt: Implement it.')
      expect(patch).toContain(`+systemPrompt: ${SHARPER_PROMPT}`)
      const readme = await readFile(join(exportDir(runId), 'developer.README.md'), 'utf-8')
      expect(readme).toContain(ROLE_ORIGIN_SOURCE)
      expect(readme).toContain(imported.origin?.version)
      expect(readme).toContain('git apply')
      expect(readme).toContain(PROPOSALS[0].evidence)
      expect(db.getWorkflowRoleProposal(proposals[0].id)?.state).toBe('exported')
      expect(
        db.listWorkflowEvents(runId, 0).find((event) => event.kind === 'role_proposal_exported')
      ).toMatchObject({
        payloadJson: { proposalId: proposals[0].id, exportPath, exportedBy: 'device_phone_1' }
      })
    })

    it('refuses a role that was not imported from an origin repository', async () => {
      const { runId, proposals } = await reflectedRun()
      const reply = await call('workflow.proposal.export', { runId, proposalId: proposals[0].id })
      expect(reply).toMatchObject({ ok: false, error: { code: 'workflow_role_not_imported' } })
      expect(db.getWorkflowRoleProposal(proposals[0].id)?.state).toBe('proposed')
      await expect(readdir(exportDir(runId))).rejects.toThrow()
    })

    it('refuses with the host unreachable, writing nothing locally, when the SSH workspace is gone', async () => {
      const { runId, proposals } = await reflectedRun(
        reflectionWorkflow(importedDeveloper()),
        PROPOSALS,
        {
          connectionId: 'ssh-gone'
        }
      )
      const reply = await call('workflow.proposal.export', { runId, proposalId: proposals[0].id })
      expect(reply).toMatchObject({ ok: false, error: { code: 'workflow_host_unreachable' } })
      expect(db.getWorkflowRoleProposal(proposals[0].id)?.state).toBe('proposed')
      await expect(readdir(exportDir(runId))).rejects.toThrow()
    })
  })

  it('lists the run proposals in workflow.run.show', async () => {
    const { runId, proposals } = await reflectedRun()
    const reply = await call('workflow.run.show', { runId })
    expect(reply.result?.proposals).toEqual(proposals)
  })
})
