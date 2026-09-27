import { posix } from 'node:path'
import type { ResultContract } from '../../../shared/workflows/workflow-definition-types'
import type { CaptureResultArgs } from './workflow-result-capture'
import { captureNodeResult } from './workflow-result-capture'
import type { WorkflowFilesystem } from './workflow-file-store-filesystem'

export const runId = 'run-1'
export const attemptId = 'attempt-1'
export const reportPath = `.orca/workflow-runs/${runId}/${attemptId}/result.json`
const resultContract: ResultContract = { type: 'object', properties: {} }

export function captureArtifacts(
  fs: WorkflowFilesystem,
  workspaceRoot: string,
  declaredArtifacts: { path: string; required: boolean }[],
  artifactGlob?: CaptureResultArgs['artifactGlob']
) {
  return captureNodeResult({
    fs,
    workspaceRoot,
    runId,
    attemptId,
    reportPath,
    outcome: 'succeeded',
    resultContract,
    declaredArtifacts,
    ...(artifactGlob ? { artifactGlob } : {})
  })
}

type FakeEntry = { isDirectory: boolean; isSymlink: boolean }

/**
 * SSH-shaped provider over workspace-relative `files` (their parent dirs are implied, and the
 * attempt's result.json is always present). Like the relay, a symlinked dir reports isDirectory.
 */
export function fakeRemoteFilesystem(
  root: string,
  tree: { files: string[]; symlinkedDirs?: string[] },
  onReadDir: (dirPath: string) => void = () => {}
): WorkflowFilesystem {
  const entries = new Map<string, FakeEntry>([[root, { isDirectory: true, isSymlink: false }]])
  const add = (relativePath: string, entry: FakeEntry) => {
    const segments = relativePath.split('/')
    for (let i = 1; i < segments.length; i += 1) {
      entries.set(posix.join(root, ...segments.slice(0, i)), {
        isDirectory: true,
        isSymlink: false
      })
    }
    entries.set(posix.join(root, relativePath), entry)
  }
  for (const file of [reportPath, ...tree.files]) {
    add(file, { isDirectory: false, isSymlink: false })
  }
  for (const dir of tree.symlinkedDirs ?? []) {
    add(dir, { isDirectory: true, isSymlink: true })
  }
  const notUsed = async (): Promise<never> => {
    throw new Error('not used')
  }
  return {
    async readDir(dirPath) {
      onReadDir(dirPath)
      const self = entries.get(dirPath)
      if (!self?.isDirectory || self.isSymlink) {
        throw new Error(`ENOENT ${dirPath}`)
      }
      return [...entries]
        .filter(([path]) => posix.dirname(path) === dirPath && path !== dirPath)
        .map(([path, entry]) => ({ name: posix.basename(path), ...entry }))
    },
    async readFile(filePath) {
      const entry = entries.get(filePath)
      if (!entry || entry.isDirectory) {
        throw new Error(`ENOENT ${filePath}`)
      }
      return '{}'
    },
    writeFile: notUsed,
    deletePath: notUsed,
    createDir: notUsed
  }
}
