import { describe, expect, it } from 'vitest'
import type { Role } from '../../../shared/workflows/workflow-definition-types'
import type { FetchedRole, RoleContent } from './workflow-role-import'
import { applyImportedRole, roleContentHash } from './workflow-role-import-merge'
import { IMPORT_NOW, ROLE_SOURCE, SHA_1, SHA_2 } from './workflow-role-import-test-fixtures'

const LATER = '2026-10-01T00:00:00.000Z'

function content(systemPrompt: string): RoleContent {
  return {
    name: 'Engagement Manager',
    agent: 'claude',
    systemPrompt,
    skills: [{ name: 'deck', source: { kind: 'plugin', plugin: 'consulting' }, required: true }]
  }
}

function fetched(systemPrompt: string, version: string, importedAt = LATER): FetchedRole {
  return {
    roleId: 'manager',
    source: ROLE_SOURCE,
    version,
    importedAt,
    content: content(systemPrompt)
  }
}

/** A role as the first import at SHA_1 wrote it, optionally edited afterwards. */
function imported(systemPrompt: string, editedPrompt?: string): Role {
  const role = applyImportedRole(
    undefined,
    fetched(systemPrompt, SHA_1, IMPORT_NOW.toISOString())
  ).role
  return editedPrompt === undefined ? role : { ...role, systemPrompt: editedPrompt }
}

describe('applyImportedRole', () => {
  it('re-import takes upstream when the local copy is unchanged since import', () => {
    const result = applyImportedRole(imported('Old.'), fetched('New.', SHA_2))
    expect(result.availableVersion).toBeUndefined()
    expect(result.role).toMatchObject({
      systemPrompt: 'New.',
      origin: {
        version: SHA_2,
        importedAt: LATER,
        localModified: false,
        contentHash: roleContentHash(content('New.'))
      }
    })
  })

  it('keeps an unflagged local edit when upstream moves, flags it, and keeps the old origin', () => {
    const local = imported('Upstream v1.', 'My local prompt.')
    expect(local.origin?.localModified).toBe(false)

    const result = applyImportedRole(local, fetched('Upstream v2.', SHA_2))
    expect(result.availableVersion).toBe(SHA_2)
    expect(result.role).toEqual({
      ...local,
      origin: { ...local.origin, localModified: true }
    })
    expect(result.role.origin).toMatchObject({
      version: SHA_1,
      importedAt: IMPORT_NOW.toISOString(),
      contentHash: roleContentHash(content('Upstream v1.'))
    })
  })

  it('overwriteLocal takes upstream over a local edit', () => {
    const result = applyImportedRole(
      imported('Upstream v1.', 'My local prompt.'),
      fetched('Upstream v2.', SHA_2),
      { overwriteLocal: true }
    )
    expect(result.availableVersion).toBeUndefined()
    expect(result.role).toMatchObject({
      systemPrompt: 'Upstream v2.',
      origin: { version: SHA_2, importedAt: LATER, localModified: false }
    })
  })

  it('treats a role whose origin lacks contentHash as possibly modified', () => {
    const legacy = imported('Upstream v1.')
    const { contentHash: _hash, ...legacyOrigin } = legacy.origin ?? {
      source: ROLE_SOURCE,
      version: SHA_1,
      importedAt: '',
      localModified: false
    }
    const result = applyImportedRole(
      { ...legacy, origin: legacyOrigin },
      fetched('Upstream v2.', SHA_2)
    )
    expect(result.availableVersion).toBe(SHA_2)
    expect(result.role).toMatchObject({
      systemPrompt: 'Upstream v1.',
      origin: { version: SHA_1, localModified: true }
    })
    expect(result.role.origin).not.toHaveProperty('contentHash')
  })

  it('keeps a hand-written role with the same id and reports the upstream version', () => {
    const { origin: _origin, ...handWritten } = imported('Hand written.')
    const result = applyImportedRole(handWritten, fetched('Upstream.', SHA_1))
    expect(result).toEqual({ role: handWritten, availableVersion: SHA_1 })
  })

  it('clears the flag when the local copy matches upstream again', () => {
    const local = imported('Same.')
    const flagged: Role = local.origin
      ? { ...local, origin: { ...local.origin, localModified: true } }
      : local
    const result = applyImportedRole(flagged, fetched('Same.', SHA_2))
    expect(result.role.origin).toMatchObject({ version: SHA_2, localModified: false })
  })

  it('hashes content independently of key order and absent optional fields', () => {
    const a = content('x')
    const reordered: RoleContent = {
      skills: a.skills,
      systemPrompt: 'x',
      model: undefined,
      agent: 'claude',
      name: 'Engagement Manager'
    }
    expect(roleContentHash(reordered)).toBe(roleContentHash(a))
  })
})
