import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../../../orca-runtime'
import { OrchestrationDb } from '../../../../orchestration/db'
import {
  engineCoordinatorHandle,
  engineCoordinatorPaneKey,
  type WorkflowEnginePrincipal
} from '../../../../workflows/workflow-engine-principal'
import { ORCHESTRATION_METHODS } from '../../orchestration'
import { resolveOrchestrationCaller, resolveRunScope } from './run-scope'

const COORDINATOR_PANE_KEY = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKFLOW_RUN_ID = 'wfr_000000000001'
const ENGINE: WorkflowEnginePrincipal = { kind: 'workflow-engine', workflowRunId: WORKFLOW_RUN_ID }

describe('resolveRunScope / resolveOrchestrationCaller principals', () => {
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let terminalRunId: string
  let engineRunId: string

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_coord' ? COORDINATOR_PANE_KEY : null
    )
    terminalRunId = db.createRun({
      objective: 'terminal run',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: COORDINATOR_PANE_KEY
    }).id
    engineRunId = db.createWorkflowEngineRun({
      workflowRunId: WORKFLOW_RUN_ID,
      objective: 'engine run'
    }).id
  })

  afterEach(() => {
    db.close()
  })

  function scope(params: Partial<Parameters<typeof resolveRunScope>[1]>) {
    return resolveRunScope(runtime, { requireCurrentConsumer: true, ...params })
  }

  describe('workflow-engine principal', () => {
    it('binds the engine Run to the engine coordinator identity and workflow run', () => {
      const run = db.getRun(engineRunId)
      expect(run).toMatchObject({
        coordinator_handle: engineCoordinatorHandle(WORKFLOW_RUN_ID),
        coordinator_pane_key: engineCoordinatorPaneKey(WORKFLOW_RUN_ID),
        workflow_run_id: WORKFLOW_RUN_ID
      })
      expect(engineCoordinatorHandle(WORKFLOW_RUN_ID)).toBe(`workflow-engine:${WORKFLOW_RUN_ID}`)
    })

    it('resolves its own Run with no terminal handle', () => {
      expect(scope({ principal: ENGINE }).id).toBe(engineRunId)
      expect(scope({ principal: ENGINE, runId: engineRunId }).id).toBe(engineRunId)
      expect(
        scope({ principal: ENGINE, callerTerminalHandle: engineCoordinatorHandle(WORKFLOW_RUN_ID) })
          .id
      ).toBe(engineRunId)
    })

    it('cannot reach another Run, even for reads', () => {
      expect(() => scope({ principal: ENGINE, runId: terminalRunId })).toThrow(
        expect.objectContaining({ code: 'consumer_fenced' })
      )
      expect(() =>
        scope({ principal: ENGINE, runId: terminalRunId, requireCurrentConsumer: false })
      ).toThrow(expect.objectContaining({ code: 'consumer_fenced' }))
    })

    it('refuses a declared terminal handle that is not the engine identity', () => {
      expect(() => scope({ principal: ENGINE, callerTerminalHandle: 'term_coord' })).toThrow(
        expect.objectContaining({ code: 'consumer_fenced' })
      )
    })

    it('requires a Run bound to its workflow run', () => {
      expect(() =>
        scope({ principal: { kind: 'workflow-engine', workflowRunId: 'wfr_unbound' } })
      ).toThrow(expect.objectContaining({ code: 'run_required' }))
    })

    it('is fenced once the Run no longer carries the engine binding', () => {
      db.db
        .prepare('UPDATE runs SET coordinator_pane_key = ? WHERE id = ?')
        .run(COORDINATOR_PANE_KEY, engineRunId)
      expect(() => scope({ principal: ENGINE })).toThrow(
        expect.objectContaining({ code: 'consumer_fenced' })
      )
    })

    it('resolves the engine pane key as its caller identity', () => {
      expect(
        resolveOrchestrationCaller(runtime, {
          callerTerminalHandle: engineCoordinatorHandle(WORKFLOW_RUN_ID),
          principal: ENGINE,
          requireStablePane: true
        })
      ).toBe(engineCoordinatorPaneKey(WORKFLOW_RUN_ID))
      expect(() =>
        resolveOrchestrationCaller(runtime, {
          callerTerminalHandle: 'term_coord',
          principal: ENGINE
        })
      ).toThrow(expect.objectContaining({ code: 'consumer_fenced' }))
    })
  })

  describe('terminal callers on an engine-owned Run', () => {
    it('refuses mutations with workflow_owned_run', () => {
      expect(() => scope({ runId: engineRunId, callerTerminalHandle: 'term_coord' })).toThrow(
        expect.objectContaining({ code: 'workflow_owned_run' })
      )
    })

    it('refuses a forged engine pane key', () => {
      expect(() =>
        scope({
          callerTerminalHandle: 'term_other',
          callerPaneKey: engineCoordinatorPaneKey(WORKFLOW_RUN_ID)
        })
      ).toThrow(expect.objectContaining({ code: 'workflow_owned_run' }))
    })

    it('refuses run-use so a terminal cannot rebind the engine Run', () => {
      const runUse = ORCHESTRATION_METHODS.find((m) => m.name === 'orchestration.runUse')
      if (!runUse?.params) {
        throw new Error('runUse method is not registered')
      }
      const params = runUse.params.parse({ id: engineRunId, from: 'term_coord' })
      expect(() => runUse.handler(params, { runtime })).toThrow(
        expect.objectContaining({ code: 'workflow_owned_run' })
      )
      expect(db.getRun(engineRunId)?.coordinator_pane_key).toBe(
        engineCoordinatorPaneKey(WORKFLOW_RUN_ID)
      )
    })

    it('still allows explicit read-only inspection', () => {
      expect(scope({ runId: engineRunId, requireCurrentConsumer: false }).id).toBe(engineRunId)
    })

    it('never treats a terminal-kind principal as engine authority', () => {
      expect(() =>
        scope({
          runId: engineRunId,
          callerTerminalHandle: 'term_coord',
          principal: { kind: 'terminal', handle: 'term_coord' }
        })
      ).toThrow(expect.objectContaining({ code: 'workflow_owned_run' }))
    })
  })

  describe('existing terminal behaviour', () => {
    it('resolves the pane-bound Run', () => {
      expect(scope({ callerTerminalHandle: 'term_coord' }).id).toBe(terminalRunId)
      expect(scope({ runId: terminalRunId, callerTerminalHandle: 'term_coord' }).id).toBe(
        terminalRunId
      )
    })

    it('keeps run_required, stable_pane_required and consumer_fenced', () => {
      expect(() => scope({})).toThrow(expect.objectContaining({ code: 'run_required' }))
      expect(() => scope({ callerTerminalHandle: 'term_nopane' })).toThrow(
        expect.objectContaining({ code: 'stable_pane_required' })
      )
      const other = db.createRun({
        objective: 'other',
        coordinatorHandle: 'term_x',
        coordinatorPaneKey: 'tab_x:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      })
      expect(() => scope({ runId: other.id, callerTerminalHandle: 'term_coord' })).toThrow(
        expect.objectContaining({ code: 'consumer_fenced' })
      )
    })

    it('returns the terminal pane key unchanged', () => {
      expect(resolveOrchestrationCaller(runtime, { callerTerminalHandle: 'term_coord' })).toBe(
        COORDINATOR_PANE_KEY
      )
      expect(resolveOrchestrationCaller(runtime, { callerTerminalHandle: 'term_nopane' })).toBe(
        null
      )
    })
  })
})
