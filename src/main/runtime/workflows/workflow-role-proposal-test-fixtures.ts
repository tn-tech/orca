// A workflow ending in a Reflection node, and a project repo on disk holding it, shared by the
// Reflection proposal tests.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Repo } from '../../../shared/repo-types'
import type { Role, Workflow } from '../../../shared/workflows/workflow-definition-types'
import { serializeWorkflowFile } from '../rpc/methods/workflows/workflow-file-serialization'
import { writeWorkflow } from './workflow-file-store'
import { branchAgent } from './workflow-run-controller-join-fixtures'
import { roleContentHash } from './workflow-role-import-merge'

export const ROLE_ORIGIN_SOURCE = 'https://git.example.com/acme/roles.git'

const developer: Role = {
  id: 'developer',
  name: 'Developer',
  agent: 'codex',
  systemPrompt: 'Implement it.',
  skills: []
}

/** `developer` as imported from ROLE_ORIGIN_SOURCE and never edited since. */
export function importedDeveloper(): Role {
  const { id: _id, ...content } = developer
  return {
    ...developer,
    origin: {
      source: ROLE_ORIGIN_SOURCE,
      version: '0123456789abcdef',
      importedAt: '2026-09-01T00:00:00.000Z',
      localModified: false,
      contentHash: roleContentHash(content)
    }
  }
}

/** start -> implement -> reflect -> end */
export function reflectionWorkflow(developerRole: Role = developer): Workflow {
  return {
    version: 1,
    name: 'reflective',
    workspacePolicy: 'run-workspace',
    roles: {
      developer: developerRole,
      coach: {
        id: 'coach',
        name: 'Coach',
        agent: 'codex',
        systemPrompt: 'Review the run.',
        skills: []
      }
    },
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      branchAgent('implement'),
      {
        id: 'reflect',
        type: 'reflection',
        title: 'Reflect',
        roleId: 'coach',
        prompt: 'Review how ${objective} went.'
      },
      { id: 'end', type: 'end', title: 'Done' }
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'implement' },
      { id: 'e2', from: 'implement', to: 'reflect' },
      { id: 'e3', from: 'reflect', to: 'end' }
    ],
    layout: {}
  }
}

/** A local project repo at `<root>/project` whose `orca-workflows/` holds `definition`. */
export async function writeProjectWorkflow(root: string, definition: Workflow): Promise<Repo> {
  const repo: Repo = {
    id: 'repo',
    path: join(root, 'project'),
    displayName: 'Project',
    badgeColor: '#000',
    addedAt: 0
  }
  await mkdir(repo.path, { recursive: true })
  await writeWorkflow(repo, 'project', definition.name, serializeWorkflowFile(definition), null)
  return repo
}
