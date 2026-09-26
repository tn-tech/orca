// Skill-install file operations run as POSIX shell commands on the workspace's own host (SSH relay
// or WSL distro), so they behave as the local ones do: symlinks the skills CLI creates are checked
// and copied as links (`cp -RP`), never followed. Paths travel as positional arguments, never
// spliced into the script, and file content goes over stdin.
import type { ProcessResult } from '../../../shared/child-process/run-process'
import type { WorkflowSkillFilesystem } from './workflow-skill-provisioning'

/** Runs `sh -c <script> sh <args...>` on the host, with `input` on stdin. */
export type PosixShellRunner = (
  script: string,
  args: readonly string[],
  input?: string
) => Promise<ProcessResult>

/** Our own "no such path" exit, distinct from any failure `test`, `cat` or the shell reports. */
const MISSING_EXIT_CODE = 3

function shellFailure(what: string, path: string, result: ProcessResult): Error {
  const why = result.timedOut ? 'timed out' : `exited with code ${String(result.code)}`
  const detail = result.stderr.trim()
  return new Error(
    `Could not ${what} ${path} on the workspace host: ${why}${detail ? `: ${detail}` : ''}`
  )
}

export function posixShellSkillFilesystem(sh: PosixShellRunner): WorkflowSkillFilesystem {
  async function run(what: string, script: string, args: string[], input?: string) {
    const result = await sh(script, args, input)
    if (result.code !== 0) {
      throw shellFailure(what, args[0], result)
    }
  }
  /** `true` present, `false` missing; any other outcome is an error, never "missing". */
  async function probe(what: string, script: string, path: string) {
    const result = await sh(script, [path])
    if (result.code !== 0 && result.code !== MISSING_EXIT_CODE) {
      throw shellFailure(what, path, result)
    }
    return result
  }
  return {
    async exists(path) {
      const result = await probe(
        'check',
        `[ -e "$1" ] || [ -L "$1" ] || exit ${MISSING_EXIT_CODE}`,
        path
      )
      return result.code === 0
    },
    async readText(path) {
      const result = await probe(
        'read',
        `[ -e "$1" ] || exit ${MISSING_EXIT_CODE}; exec cat -- "$1"`,
        path
      )
      return result.code === 0 ? result.stdout : null
    },
    async writeText(path, content) {
      await run('write', 'mkdir -p -- "$(dirname "$1")" && cat > "$1"', [path], content)
    },
    async removePath(path) {
      await run('remove', 'rm -rf -- "$1"', [path])
    },
    async copyPath(from, to) {
      await run('copy', 'rm -rf -- "$2" && mkdir -p -- "$(dirname "$2")" && cp -RP -- "$1" "$2"', [
        from,
        to
      ])
    }
  }
}
