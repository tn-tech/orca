// Reads a file from a fetched (untrusted) repository checkout. Tracked files may be symlinks, so a
// read resolves the real path first and serves only a regular file inside the checkout, outside
// its `.git`, within a byte cap: a link to a host file, `/dev/zero` or a FIFO is refused, never read.
// A symlink to another file inside the checkout is followed, as the skills CLI does.
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { relativePathInsideRoot } from '../../../shared/cross-platform-path'
import type { IFilesystemProvider } from '../../providers/types'
import { OrchestrationError } from '../orchestration/orchestration-error'

/** SKILL.md, role files and plugin manifests are small; nothing larger is inlined or parsed. */
export const CHECKOUT_FILE_MAX_BYTES = 1024 * 1024
export const CHECKOUT_FILE_REFUSED_CODE = 'workflow_checkout_file_refused'
const MAX_LABEL = '1 MiB'

// Why: absent on Windows; there the realpath containment check is what excludes links.
const OPEN_NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
// Why: a FIFO swapped in after the type check must not block the main process on open.
const OPEN_NONBLOCK = typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0

export class CheckoutFileRefusedError extends OrchestrationError {
  constructor(
    readonly path: string,
    readonly reason: string
  ) {
    super(
      CHECKOUT_FILE_REFUSED_CODE,
      `Refused to read "${path}" from the fetched repository: ${reason}.`,
      { path, reason }
    )
    this.name = 'CheckoutFileRefusedError'
  }
}

function displayPath(checkoutDir: string, filePath: string): string {
  return relativePathInsideRoot(checkoutDir, filePath) || filePath
}

/** Throws unless `realFile` is strictly inside `realRoot` and not under its `.git`. */
function assertInsideCheckout(realRoot: string, realFile: string, path: string): void {
  const relative = relativePathInsideRoot(realRoot, realFile)
  if (!relative) {
    throw new CheckoutFileRefusedError(path, 'it resolves outside the checkout')
  }
  if (relative.split(/[\\/]/)[0]?.toLowerCase() === '.git') {
    throw new CheckoutFileRefusedError(path, 'it resolves into the checkout’s .git directory')
  }
}

function assertReadableSize(size: number, path: string): void {
  if (size > CHECKOUT_FILE_MAX_BYTES) {
    throw new CheckoutFileRefusedError(path, `it is larger than the ${MAX_LABEL} limit`)
  }
}

function notRegularFile(path: string): CheckoutFileRefusedError {
  return new CheckoutFileRefusedError(path, 'it is not a regular file')
}

/** Reads at most `limit + 1` bytes, so an over-cap file is detected without reading it all. */
async function readBounded(handle: FileHandle, limit: number): Promise<Buffer> {
  const buffer = Buffer.alloc(limit + 1)
  let total = 0
  while (total < buffer.length) {
    const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total)
    if (bytesRead === 0) {
      break
    }
    total += bytesRead
  }
  return buffer.subarray(0, total)
}

export async function readLocalCheckoutFile(
  filePath: string,
  checkoutDir: string
): Promise<string> {
  const path = displayPath(checkoutDir, filePath)
  const [realRoot, realFile] = await Promise.all([realpath(checkoutDir), realpath(filePath)])
  assertInsideCheckout(realRoot, realFile, path)
  const stats = await stat(realFile)
  if (!stats.isFile()) {
    throw notRegularFile(path)
  }
  assertReadableSize(stats.size, path)
  const handle = await open(realFile, constants.O_RDONLY | OPEN_NOFOLLOW | OPEN_NONBLOCK)
  try {
    if (!(await handle.stat()).isFile()) {
      throw notRegularFile(path)
    }
    const buffer = await readBounded(handle, CHECKOUT_FILE_MAX_BYTES)
    assertReadableSize(buffer.length, path)
    return buffer.toString('utf-8')
  } finally {
    await handle.close()
  }
}

export type CheckoutFileRemoteFs = Pick<IFilesystemProvider, 'realpath' | 'stat' | 'readFile'>

/**
 * The relay's `fs.stat` reports FIFOs, devices and sockets as `file`, so over SSH those are
 * excluded by containment alone: `git clone` writes only regular files, symlinks and dirs.
 */
export async function readRemoteCheckoutFile(
  fs: CheckoutFileRemoteFs,
  filePath: string,
  checkoutDir: string
): Promise<string> {
  const path = displayPath(checkoutDir, filePath)
  const [realRoot, realFile] = await Promise.all([fs.realpath(checkoutDir), fs.realpath(filePath)])
  assertInsideCheckout(realRoot, realFile, path)
  const stats = await fs.stat(realFile)
  if (stats.type !== 'file') {
    throw notRegularFile(path)
  }
  assertReadableSize(stats.size, path)
  // Why the real path: reading the link again could land somewhere the check never saw.
  const result = await fs.readFile(realFile, {
    maxTextBytes: CHECKOUT_FILE_MAX_BYTES,
    maxBinaryBytes: CHECKOUT_FILE_MAX_BYTES
  })
  if (result.isBinary) {
    throw new Error('workflow_role_file_binary')
  }
  assertReadableSize(Buffer.byteLength(result.content, 'utf-8'), path)
  return result.content
}
