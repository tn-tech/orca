import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Repo } from '../../../shared/repo-types'
import {
  getSshFilesystemProvider,
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE
} from '../../providers/ssh-filesystem-dispatch'
import type { IFilesystemProvider } from '../../providers/types'

/** Minimal filesystem surface the workflow file store needs, local or SSH. */
export type WorkflowFilesystem = {
  readDir(dirPath: string): Promise<{ name: string; isDirectory: boolean }[]>
  readFile(filePath: string): Promise<string>
  writeFile(filePath: string, content: string): Promise<void>
  deletePath(filePath: string): Promise<void>
  createDir(dirPath: string): Promise<void>
}

export const localWorkflowFilesystem: WorkflowFilesystem = {
  async readDir(dirPath) {
    const dirents = await readdir(dirPath, { withFileTypes: true })
    return dirents.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
  },
  async readFile(filePath) {
    return readFile(filePath, 'utf-8')
  },
  async writeFile(filePath, content) {
    await writeFile(filePath, content, 'utf-8')
  },
  async deletePath(filePath) {
    await rm(filePath)
  },
  async createDir(dirPath) {
    await mkdir(dirPath, { recursive: true })
  }
}

function sshWorkflowFilesystem(fsProvider: IFilesystemProvider): WorkflowFilesystem {
  return {
    async readDir(dirPath) {
      const entries = await fsProvider.readDir(dirPath)
      return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory }))
    },
    async readFile(filePath) {
      const result = await fsProvider.readFile(filePath)
      if (result.isBinary) {
        throw new Error('workflow_file_binary')
      }
      return result.content
    },
    async writeFile(filePath, content) {
      await fsProvider.writeFile(filePath, content)
    },
    async deletePath(filePath) {
      await fsProvider.deletePath(filePath, false)
    },
    async createDir(dirPath) {
      await fsProvider.createDir(dirPath)
    }
  }
}

/** Project-source files live on the repo's execution host; no local fallback when SSH is unreachable (FR-038). */
export function getProjectWorkflowFilesystem(repo: Repo): WorkflowFilesystem {
  if (!repo.connectionId) {
    return localWorkflowFilesystem
  }
  const fsProvider = getSshFilesystemProvider(repo.connectionId)
  if (!fsProvider) {
    throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
  }
  return sshWorkflowFilesystem(fsProvider)
}

/** Personal workflows always live on this machine, even for an SSH-backed repo (no remote-home precedent). */
export function personalWorkflowsDirectory(): string {
  return join(homedir(), '.orca', 'workflows')
}
