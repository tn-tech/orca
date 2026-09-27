import { describe, expect, it, vi } from 'vitest'
import type { SkillReference } from '../../../shared/workflows/workflow-skill-reference-schema'
import type { RoleFetchHost } from './workflow-role-fetch-host'
import { fetchFallbackSkillTexts } from './workflow-skill-fallback-text'

const SOURCE = 'https://github.com/acme/skills'

function skill(name: string, required = true, location = `${SOURCE}.git`): SkillReference {
  return { name, source: { kind: 'repository', location }, required }
}

function skillMd(name: string, body = 'Do it.'): string {
  return `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}`
}

/** A repository checkout on a fake execution host: tracked path -> file text. */
function fakeHost(files: Record<string, string>, options: { cloneError?: Error } = {}) {
  const calls: string[][] = []
  const removed: string[] = []
  const host: RoleFetchHost = {
    createTempDir: vi.fn(async () => '/host/tmp/t1'),
    clone: vi.fn(async (source, version, cwd, dirName) => {
      calls.push(['clone', source, String(version), cwd, dirName])
      if (options.cloneError) {
        throw options.cloneError
      }
    }),
    runGit: vi.fn(async (args, cwd) => {
      calls.push([...args, cwd])
      return Object.keys(files)
        .map((path) => `${path}\0`)
        .join('')
    }),
    readFile: vi.fn(async (path: string) => {
      const relative = path.replace('/host/tmp/t1/repo/', '')
      const text = files[relative]
      if (text === undefined) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      return text
    }),
    removeDir: vi.fn(async (dir: string) => {
      removed.push(dir)
    }),
    joinPath: (dir, relative) => `${dir}/${relative}`
  }
  return { host, calls, removed }
}

describe('fetchFallbackSkillTexts', () => {
  it('does nothing for an agent that loads workspace skills', async () => {
    const getHost = vi.fn()
    const texts = await fetchFallbackSkillTexts(
      { agent: 'claude', skills: [skill('plan')] },
      { allowlist: [SOURCE], getHost }
    )
    expect(texts.size).toBe(0)
    expect(getHost).not.toHaveBeenCalled()
  })

  it('leaves a non-allowlisted source to provisioning’s refusal, without cloning', async () => {
    const getHost = vi.fn()
    const texts = await fetchFallbackSkillTexts(
      { agent: 'aider', skills: [skill('plan', true, 'https://evil.test/skills')] },
      { allowlist: [SOURCE], getHost }
    )
    expect(texts.size).toBe(0)
    expect(getHost).not.toHaveBeenCalled()
  })

  it('clones the matched allowlist entry and finds SKILL.md where the skills CLI looks', async () => {
    const { host, calls, removed } = fakeHost({
      'README.md': '# readme',
      'docs/plan/SKILL.md': skillMd('plan', 'too deep a match for the priority pass'),
      'skills/plan/SKILL.md': skillMd('plan', 'The real plan skill.'),
      'skills/review-dir/SKILL.md': skillMd('review')
    })
    const texts = await fetchFallbackSkillTexts(
      { agent: 'aider', skills: [skill('plan'), skill('review')] },
      { allowlist: [SOURCE], getHost: () => host }
    )
    expect(calls[0]).toEqual(['clone', SOURCE, 'undefined', '/host/tmp/t1', 'repo'])
    expect(calls[1]).toEqual(['ls-files', '-z', '/host/tmp/t1/repo'])
    expect(texts.get('plan')).toEqual({
      source: SOURCE,
      path: 'skills/plan/SKILL.md',
      text: skillMd('plan', 'The real plan skill.')
    })
    // Matched by frontmatter name, as `skills add --skill` does, not by directory.
    expect(texts.get('review')?.path).toBe('skills/review-dir/SKILL.md')
    expect(removed).toEqual(['/host/tmp/t1'])
  })

  it('fails before launch when a required skill has no SKILL.md, and cleans up', async () => {
    const { host, removed } = fakeHost({ 'skills/other/SKILL.md': skillMd('other') })
    await expect(
      fetchFallbackSkillTexts(
        { agent: 'aider', skills: [skill('plan')] },
        { allowlist: [SOURCE], getHost: () => host }
      )
    ).rejects.toThrow(/Skill "plan" has no SKILL\.md .*acme\/skills.*"aider"/)
    expect(removed).toEqual(['/host/tmp/t1'])
  })

  it('ignores a SKILL.md whose path could break the brief’s markdown', async () => {
    const { host } = fakeHost({ 'skills/pl\nan/SKILL.md': skillMd('plan') })
    await expect(
      fetchFallbackSkillTexts(
        { agent: 'aider', skills: [skill('plan')] },
        { allowlist: [SOURCE], getHost: () => host }
      )
    ).rejects.toThrow(/has no SKILL\.md/)
  })

  it('skips an optional skill that has no SKILL.md', async () => {
    const { host } = fakeHost({})
    const texts = await fetchFallbackSkillTexts(
      { agent: 'aider', skills: [skill('plan', false)] },
      { allowlist: [SOURCE], getHost: () => host }
    )
    expect(texts.size).toBe(0)
  })

  it('reads each repository file at most once per fetch', async () => {
    const { host } = fakeHost({
      'skills/x/SKILL.md': skillMd('a'),
      'skills/y/SKILL.md': skillMd('b'),
      'skills/z/SKILL.md': skillMd('c')
    })
    const texts = await fetchFallbackSkillTexts(
      { agent: 'aider', skills: [skill('c'), skill('b'), skill('a')] },
      { allowlist: [SOURCE], getHost: () => host }
    )
    expect([...texts.keys()]).toEqual(['c', 'b', 'a'])
    const reads = vi.mocked(host.readFile).mock.calls.map(([path]) => path)
    expect(reads).toHaveLength(new Set(reads).size)
  })

  it('skips optional skills whose repository cannot be cloned', async () => {
    const { host, removed } = fakeHost({}, { cloneError: new Error('repository not found') })
    const texts = await fetchFallbackSkillTexts(
      { agent: 'aider', skills: [skill('plan', false)] },
      { allowlist: [SOURCE], getHost: () => host }
    )
    expect(texts.size).toBe(0)
    expect(removed).toEqual(['/host/tmp/t1'])
  })

  it('fails a required skill whose repository cannot be cloned, naming the source', async () => {
    const { host, removed } = fakeHost({}, { cloneError: new Error('repository not found') })
    await expect(
      fetchFallbackSkillTexts(
        { agent: 'aider', skills: [skill('plan')] },
        { allowlist: [SOURCE], getHost: () => host }
      )
    ).rejects.toThrow(/plan.*acme\/skills.*repository not found/)
    expect(removed).toEqual(['/host/tmp/t1'])
  })
})
