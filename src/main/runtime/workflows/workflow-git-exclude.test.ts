import { describe, expect, it } from 'vitest'
import {
  appendRunExcludeEntries,
  excludePatternFor,
  removeRunExcludeEntries,
  withoutRunExcludeEntries,
  withRunExcludeEntries,
  type GitExcludeFileAccess
} from './workflow-git-exclude'

function memoryFile(initial: string | null): GitExcludeFileAccess & { content: string | null } {
  const file = {
    content: initial,
    async readText() {
      return file.content
    },
    async writeText(_path: string, content: string) {
      file.content = content
    }
  }
  return file
}

describe('workflow git exclude entries', () => {
  it('anchors each path to the worktree root with forward slashes', () => {
    expect(excludePatternFor('.claude\\skills\\review')).toBe('/.claude/skills/review')
  })

  it('adds a run block after existing user entries without touching them', () => {
    const next = withRunExcludeEntries('/scratch', 'wfr_1', ['.claude/skills/review'])
    expect(next).toBe(
      '/scratch\n# >>> orca workflow run wfr_1\n/.claude/skills/review\n# <<< orca workflow run wfr_1\n'
    )
  })

  it('extends an existing block and never duplicates an entry', () => {
    const once = withRunExcludeEntries('', 'wfr_1', ['a', 'a'])
    const twice = withRunExcludeEntries(once, 'wfr_1', ['a', 'b'])
    expect(twice).toBe('# >>> orca workflow run wfr_1\n/a\n/b\n# <<< orca workflow run wfr_1\n')
  })

  it("removes only the finished run's block, keeping another run's copy of the same path", () => {
    const shared = withRunExcludeEntries(
      withRunExcludeEntries('/scratch\n', 'wfr_1', ['skills-lock.json']),
      'wfr_2',
      ['skills-lock.json']
    )
    const after = withoutRunExcludeEntries(shared, 'wfr_1')
    expect(after).toBe(
      '/scratch\n# >>> orca workflow run wfr_2\n/skills-lock.json\n# <<< orca workflow run wfr_2\n'
    )
    expect(withoutRunExcludeEntries(after, 'wfr_1')).toBe(after)
  })

  it('creates a missing exclude file and leaves a missing one alone on removal', async () => {
    const file = memoryFile(null)
    await removeRunExcludeEntries('/x/exclude', 'wfr_1', file)
    expect(file.content).toBeNull()
    await appendRunExcludeEntries('/x/exclude', 'wfr_1', ['a'], file)
    expect(file.content).toContain('/a\n')
  })

  it('serialises concurrent writers to the same file so no entry is lost', async () => {
    const file = memoryFile('')
    await Promise.all([
      appendRunExcludeEntries('/x/exclude', 'wfr_1', ['a'], file),
      appendRunExcludeEntries('/x/exclude', 'wfr_2', ['b'], file)
    ])
    expect(file.content).toContain('/a\n')
    expect(file.content).toContain('/b\n')
  })
})
