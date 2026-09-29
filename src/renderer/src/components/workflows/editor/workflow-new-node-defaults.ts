import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import type { Layout, Node } from '../../../../../shared/workflows/workflow-definition-types'
import { computeLoopContainerBounds, measureWorkflowNodeSize } from './workflow-auto-layout'

/**
 * Node kinds the "Add node" menu offers (`WorkflowCanvas.tsx`'s `NODE_TYPES`, minus Loop). A Loop
 * needs at least one body node, so it is created by wrapping a selection
 * (`workflow-loop-commands.ts`) and grown from its inspector (`LoopMembershipFields.tsx`).
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

/** The absolute bottom edge of `node`'s rendered box: a Loop renders as a container sized around
 *  its body nodes' own boxes (`computeLoopContainerBounds`, review round 1 minor #1 — can be much
 *  taller than the base node height), every other kind renders at its `measureWorkflowNodeSize`
 *  box (F10: an Agent with `overrides.model` set, or a Router/Approval with choices, both render
 *  taller than the base card). */
function nodeBottom(node: Node, nodesById: ReadonlyMap<string, Node>, layout: Layout): number {
  const position = layout[node.id] ?? { x: 0, y: 0 }
  if (node.type !== 'loop') {
    return position.y + measureWorkflowNodeSize(node).height
  }
  const bodyPositions = node.body.nodeIds.map((id) => {
    const bodyNode = nodesById.get(id)
    return {
      ...(layout[id] ?? { x: 0, y: 0 }),
      ...(bodyNode ? measureWorkflowNodeSize(bodyNode) : {})
    }
  })
  return position.y + computeLoopContainerBounds(position, bodyPositions).height
}

/** A spot below every existing node's box, so a freshly added node never lands on top of one —
 *  including an expanded Loop container, not just its own layout entry. `WorkflowCanvas.tsx`
 *  pans/fits a node added off the current viewport into view (`WorkflowCanvasAutoFit.tsx`), so
 *  this only needs to avoid overlap, not guarantee the new node is already on screen. */
export function freeNodePosition(nodes: readonly Node[], layout: Layout): { x: number; y: number } {
  const positions = Object.values(layout)
  if (positions.length === 0) {
    return { x: 0, y: 0 }
  }
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  return {
    x: Math.min(...positions.map((position) => position.x)),
    y: Math.max(...nodes.map((node) => nodeBottom(node, nodesById, layout))) + NEW_NODE_GAP
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
