# Contract: Workflow file (`*.workflow.yaml`)

Location: `<project>/orca-workflows/<name>.workflow.yaml` (or `workflows.directory` from
`orca.yaml`), and `~/.orca/workflows/<name>.workflow.yaml` for personal copies. Parsed with the
`yaml` package; validated with the zod schema in `src/shared/workflows/workflow-definition-schema.ts`.
Shape and rules: see `../data-model.md` section 1.

## Example: developer to QA loop with an approval

```yaml
version: 1
name: feature-with-qa
description: Spec, implement, and review with a bounded QA loop
workspacePolicy: run-workspace
concurrencyLimit: 3

roles:
  planner:
    name: Planner
    agent: claude
    model: fable
    effort: high
    systemPrompt: |
      You plan features with Spec Kit. Run /speckit-plan on the current feature.
    skills:
      - { name: speckit-plan, source: { kind: repository, location: https://github.com/github/spec-kit } }
      - { name: superpowers, source: { kind: plugin, plugin: superpowers } }
  developer:
    name: Developer
    agent: claude
    model: opus
    effort: high
    systemPrompt: Implement exactly what the plan says. Commit as you go.
    skills:
      - { name: superpowers, source: { kind: plugin, plugin: superpowers } }
  reviewer:
    name: QA Reviewer
    agent: codex
    model: gpt-5.6-terra
    effort: high
    systemPrompt: Review the diff against the spec. Be adversarial.
    skills: []

nodes:
  - { id: start, type: start, title: Start }
  - id: plan
    type: agent
    title: Plan the feature
    roleId: planner
    prompt: "Plan: ${objective}. Write the plan under specs/."
    workspace: run
    resultContract:
      type: object
      required: [planPath]
      properties: { planPath: { type: string } }
    artifacts: [{ path: "specs/**/plan.md", required: true }]
    question: { timeoutMs: 600000, escalationGraceMs: 300000 }
  - id: approve-plan
    type: approval
    title: Approve the plan?
    question: Approve the plan before implementation?
    options: [approve, reject]
    timeoutMs: 3600000
    escalationGraceMs: 1800000
  - id: qa-loop
    type: loop
    title: Implement and review
    body: { nodeIds: [implement, review] }
    entryNodeId: implement
    exitNodeId: review
    maxIterations: 3
    exitCondition: { path: approved, op: eq, value: true }
  - id: implement
    type: agent
    title: Implement
    roleId: developer
    prompt: |
      Implement the plan at ${upstream.plan.result.planPath}.
      Previous review findings, if any: ${loop.previous.review.result.findings}
    workspace: run
    resultContract:
      type: object
      required: [summary]
      properties: { summary: { type: string }, commits: { type: array, items: { type: string } } }
    artifacts: []
    question: { timeoutMs: 600000, escalationGraceMs: 300000 }
  - id: review
    type: agent
    title: Review
    roleId: reviewer
    prompt: Review the implementation of ${objective}. Return approved and findings.
    workspace: run
    resultContract:
      type: object
      required: [approved, findings]
      properties:
        approved: { type: boolean }
        findings: { type: array, items: { type: object, required: [title, severity], properties: { title: { type: string }, severity: { type: string } } } }
    artifacts: []
    question: { timeoutMs: 600000, escalationGraceMs: 300000 }
  - { id: end, type: end, title: Done }

edges:
  - { id: e1, from: start, to: plan }
  - { id: e2, from: plan, to: approve-plan }
  - { id: e3, from: approve-plan, to: qa-loop, fromPort: approve }
  - { id: e4, from: approve-plan, to: end, fromPort: reject }
  - { id: e5, from: implement, to: review }
  - { id: e6, from: review, to: implement, fromPort: body }
  - { id: e7, from: qa-loop, to: end, fromPort: exit }

layout:
  start: { x: 0, y: 0 }
  plan: { x: 240, y: 0 }
  approve-plan: { x: 480, y: 0 }
  qa-loop: { x: 720, y: 0 }
  implement: { x: 760, y: 60 }
  review: { x: 1000, y: 60 }
  end: { x: 1300, y: 0 }
```

## `orca.yaml` additions

```yaml
workflows:
  directory: orca-workflows          # optional
  allowedSources:
    - https://github.com/github/spec-kit
    - https://github.com/acme-consulting/orca-roles
```

## Versioning
- `version` is required. A host that does not know the version refuses with
  `workflow_file_version_unsupported`. A newer host upgrades older files on save only.
- Unknown keys are preserved on round-trip where possible and reported as warnings.
