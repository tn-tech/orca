import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import type { Layout, Node } from '../../../../../shared/workflows/workflow-definition-types'
import { WORKFLOW_NODE_HEIGHT } from './workflow-auto-layout'

/**
 * Node kinds the "Add node" menu offers (`WorkflowCanvas.tsx`'s `NODE_TYPES`, minus Loop). A
 * Loop's body/entry/exit have no editing UI of their own — `LoopNodeFields.tsx` deliberately
 * doesn't let the user repoint them — and the only supported way to create one is wrapping an
 * existing selection (`workflow-loop-commands.ts`); a standalone Loop from this menu would have
 * an empty body with no UI path to ever populate it, so it's left out.
 */
export const ADDABLE_NODE_KINDS = [
  'start',
  'agent',
  'router',
  'join',
  'approval',
  'reflection',
  'end'
] as const

export type AddableNodeKind = (typeof ADDABLE_NODE_KINDS)[number]

const NEW_NODE_GAP = 48

/** Same duration defaults the U57/earlier fixtures use for a fresh question/approval config
 *  (workflow-editor-state.test.ts): a 10 minute timeout, 5 minute escalation grace. */
const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_ESCALATION_GRACE_MS = 300_000

/** A spot below every existing node's box, so a freshly added node never lands on top of one.
 *  `WorkflowCanvas.tsx`'s `fitView` only runs on mount, not after this, so this only needs to
 *  avoid overlap, not guarantee the new node is in the current viewport. */
export function freeNodePosition(layout: Layout): { x: number; y: number } {
  const positions = Object.values(layout)
  if (positions.length === 0) {
    return { x: 0, y: 0 }
  }
  return {
    x: Math.min(...positions.map((position) => position.x)),
    y: Math.max(...positions.map((position) => position.y + WORKFLOW_NODE_HEIGHT)) + NEW_NODE_GAP
  }
}

export function addNodeMenuLabel(kind: AddableNodeKind): string {
  switch (kind) {
    case 'start':
      return translate('auto.components.workflows.editor.workflow-new-node-defaults.start', 'Start')
    case 'agent':
      return translate('auto.components.workflows.editor.workflow-new-node-defaults.agent', 'Agent')
    case 'router':
      return translate(
        'auto.components.workflows.editor.workflow-new-node-defaults.router',
        'Router'
      )
    case 'join':
      return translate('auto.components.workflows.editor.workflow-new-node-defaults.join', 'Join')
    case 'approval':
      return translate(
        'auto.components.workflows.editor.workflow-new-node-defaults.approval',
        'Approval'
      )
    case 'reflection':
      return translate(
        'auto.components.workflows.editor.workflow-new-node-defaults.reflection',
        'Reflection'
      )
    case 'end':
      return translate('auto.components.workflows.editor.workflow-new-node-defaults.end', 'End')
  }
}

/**
 * Builds a new node of `kind` with a unique id and a real, editable value for every required
 * field. A freshly added node is always disconnected, so `checkReachability` already flags it and
 * guides the user to wire it in (data-model.md "Graph validation rules") — per-kind fields beyond
 * that get a real placeholder rather than a blank one, matching `RouterNodeFields`/
 * `ApprovalNodeFields`'s own "Add choice"/"Add option" convention for a row with no natural default.
 */
export function createDefaultNode(kind: AddableNodeKind): Node {
  const id = `${kind}-${createBrowserUuid()}`
  const title = addNodeMenuLabel(kind)
  switch (kind) {
    case 'start':
      return { id, type: 'start', title }
    case 'end':
      return { id, type: 'end', title }
    case 'agent':
      return {
        id,
        type: 'agent',
        title,
        prompt: translate(
          'auto.components.workflows.editor.workflow-new-node-defaults.agentPrompt',
          'Describe the task for this agent.'
        ),
        workspace: 'run',
        resultContract: { type: 'object' },
        artifacts: [],
        question: { timeoutMs: DEFAULT_TIMEOUT_MS, escalationGraceMs: DEFAULT_ESCALATION_GRACE_MS }
      }
    case 'router':
      return {
        id,
        type: 'router',
        title,
        prompt: translate(
          'auto.components.workflows.editor.workflow-new-node-defaults.routerPrompt',
          'Describe how this agent should choose between the options below.'
        ),
        choices: [
          translate(
            'auto.components.workflows.editor.workflow-new-node-defaults.routerChoice',
            'Option 1'
          )
        ]
      }
    case 'join':
      return { id, type: 'join', title, policy: 'all', onFailure: 'fail' }
    case 'approval':
      return {
        id,
        type: 'approval',
        title,
        question: translate(
          'auto.components.workflows.editor.workflow-new-node-defaults.approvalQuestion',
          'Approve this step?'
        ),
        options: [
          translate(
            'auto.components.workflows.editor.workflow-new-node-defaults.approvalOption',
            'Approve'
          )
        ],
        timeoutMs: DEFAULT_TIMEOUT_MS,
        escalationGraceMs: DEFAULT_ESCALATION_GRACE_MS
      }
    case 'reflection':
      return {
        id,
        type: 'reflection',
        title,
        prompt: translate(
          'auto.components.workflows.editor.workflow-new-node-defaults.reflectionPrompt',
          'Reflect on the run so far.'
        )
      }
  }
}
