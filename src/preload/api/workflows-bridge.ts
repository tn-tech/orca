import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import type { WorkflowRunChangedPayload } from '../../shared/runtime-client-events'

export const workflowsApi = {
  onChanged: (callback: (payload: WorkflowRunChangedPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: WorkflowRunChangedPayload) =>
      callback(payload)
    ipcRenderer.on('workflows:changed', listener)
    return () => ipcRenderer.removeListener('workflows:changed', listener)
  }
} satisfies PreloadApi['workflows']
