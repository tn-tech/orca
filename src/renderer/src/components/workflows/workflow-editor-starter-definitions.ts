import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'

/** The session's placeholder while no workflow is open (`status: 'empty'`). */
export function placeholderWorkflowDefinition(): Workflow {
  return {
    version: 1,
    name: '',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [],
    edges: [],
    layout: {}
  }
}

/** A fresh workflow's starting graph: Start → End, already reachable (FR-002/graph_missing_*). */
export function newWorkflowDefinition(name: string): Workflow {
  return {
    version: 1,
    name,
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      {
        id: 'start',
        type: 'start',
        title: translate(
          'auto.components.workflows.use-workflow-editor-session.startTitle',
          'Start'
        )
      },
      {
        id: 'end',
        type: 'end',
        title: translate('auto.components.workflows.use-workflow-editor-session.endTitle', 'End')
      }
    ],
    edges: [{ id: `edge-${createBrowserUuid()}`, from: 'start', to: 'end' }],
    layout: { start: { x: 0, y: 0 }, end: { x: 320, y: 0 } }
  }
}
