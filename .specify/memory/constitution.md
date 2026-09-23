# Orca Constitution

## Core Principles

### I. Reuse Before Reimplementing

Before writing new logic at any scale (a function, component, IPC channel, state store, or
whole subsystem), the author MUST check whether an existing implementation already does the
job or nearly does. Existing code MUST be extended or generalized instead of duplicated; a
parallel implementation is permitted only when nothing fits, and the plan MUST say what was
searched and why it did not fit. UI work MUST use the tokens in the canonical stylesheet and
the shadcn primitives under `src/renderer/src/components/ui/`; inventing a color, font size,
or shadow tier that a documented one already covers is a violation.

Rationale: Orca is a large multi-process codebase (main, renderer, CLI, daemon, relay,
mobile). Parallel implementations drift, double the review surface, and are where most
cross-platform and remote regressions hide.

### II. Every Host Is a First-Class Host

Every change MUST work on macOS, Linux, and Windows, and MUST consider the SSH remote host and
the folder workspace (not only git worktrees). Platform-dependent behavior MUST live behind
runtime checks, never hardcoded assumptions (path separators, modifier keys, shell kind).
Windows child processes MUST go through the shared process runner; WSL commands MUST be built
with the shared WSL argv builder. For remote work, the execution host owns everything that
touches execution, and loss of contact is never evidence of process death: the verdict
vocabulary is exactly `live` / `unverifiable` / `exited`, with no synonyms.

Rationale: users run agents on whichever machine has the compute. A feature that silently
degrades on one host or one workspace type is a broken feature, not a partial one.

### III. Evidence Over Assumption

Behavioral claims MUST be backed by captured evidence, not memory. A rule that reads what an
agent CLI paints on a terminal MUST be written against a captured transcript. A completion
claim ("tests pass", "fixed") MUST be preceded by running the verification command and
reading its output. Signals that merely pattern-match a known failure MUST be checked
against the actual cause before any state-changing action is taken.

Testing rules:

- Existing tests MUST never be broken. A change that makes an existing test fail is
  incomplete until the code is fixed. Deleting, skipping, or weakening an existing test to
  get a green run is prohibited; when a test's expectation is legitimately obsolete, the PR
  MUST name the test and explain why the old behavior is no longer correct.
- Every new feature MUST ship with new standalone tests that exercise it in isolation, so
  the feature can be verified and reverted independently of surrounding code. Extending an
  existing test file is acceptable only when the feature changes that file's subject.
- Every bug fix MUST add a regression test that fails before the fix and passes after it.
- Tests MUST run under the existing Vitest configuration and MUST NOT depend on a visible
  window, network access, or a specific developer machine.

Rationale: agents and humans both confabulate. The project's reference docs record multiple
failed attempts that shipped on remembered screens; the transcript discipline is what ended
that cycle.

### IV. One Owner Per Fact

Each category of runtime truth has exactly one authoritative store, and every reader
subscribes to it rather than caching or re-deriving. Agent status lives in the hook server's
store on the execution host; new producers write into it and readers keep only presentation
policy. Design tokens live in the canonical stylesheet. Git capability state is scoped to the
host that executes Git and cached through the capability cache, never re-probed ad hoc.
Adding a second producer, a reader-side cache, or a precedence rule for any of these MUST be
justified in the PR against the relevant reference document.

Rationale: readers on desktop, CLI, mobile, and dashboard must agree. Divergent copies of
the same fact are the root cause of the hardest-to-reproduce bugs in this codebase.

### V. Compatibility Is a Contract

Clients and remote Orca servers update independently, so mixed versions are the normal
state. A change to anything a paired client and host exchange MUST follow the remote wire
compatibility rules: new optional fields are safe, new stream opcodes MUST be
capability-negotiated, and changes to what the host publishes MUST be evaluated against old
clients even with no wire change. Git commands MUST treat Git 2.25 as the baseline and keep a
fallback for newer options. Linux native modules MUST respect the glibc 2.31 floor.
Source-control features MUST behave correctly on GitLab and other supported providers, not
only GitHub, with provider-specific behavior behind explicit checks.

Rationale: Orca cannot force simultaneous upgrades of desktops, phones, servers, and the
user's Git binary. Breaking any one of them strands real sessions.

### VI. Upstream Baseline

This repository is a fork of `stablyai/orca`. Upstream's architecture, libraries, and
conventions are the baseline, not a suggestion. Contributors MUST NOT replace a
framework, library, or pattern upstream already uses with an equivalent (for example,
swapping the native `fetch` request wrappers, Zustand stores, i18next catalogs, Vitest,
or oxlint for alternatives), MUST NOT reformat, rename, or reorganize upstream files
without a functional reason, and MUST NOT loosen upstream lint configuration, ratchets, or
gates. Fork-specific behavior MUST be additive and isolated behind a clear boundary (a
new module, a feature flag, or a configuration entry) so that upstream changes merge
cleanly. When a fork change and an upstream pattern conflict, the upstream pattern wins
unless the PR documents why it cannot.

Rationale: every gratuitous divergence is a merge conflict on the next upstream sync and
a place where upstream's bug fixes silently stop applying. Small, additive, pattern-
conforming diffs keep the fork cheap to maintain.

## Platform and Compatibility Constraints

- Stack: Electron desktop app (main + renderer), Node CLI, terminal daemon, relay service,
  and a mobile companion, all in TypeScript with pnpm and Vitest.
- Type declarations MUST be `.ts`, not `.d.ts`. Type assertions other than `as const` MUST
  carry a line-specific `SAFETY:` justification.
- Files and modules MUST be named after the concrete concept they contain. Names such as
  `helpers`, `utils`, `common`, `misc`, or `shared-stuff` are prohibited.
- Comments MUST be concise and explain only the non-obvious "why", never the "how".
- Git scans MUST be bounded: never enumerate every ref and fan out per-ref tree reads; prefer
  `rg` over checked-out files; an unbounded scan requires measuring ref count and confirming.
- Windows-facing code MUST NOT add EDR-scored patterns (`-ExecutionPolicy Bypass`,
  `-EncodedCommand`, `cmd.exe /c` with escaped free text, runtime `Add-Type`) without first
  consulting the EDR posture reference.
- Electron UI validation MUST run in the background with `ORCA_BACKGROUND_LAUNCH=1`, MUST
  NOT steal focus or reveal windows, and MUST use CDP screenshots of hidden renderers.
- Packaging for another architecture MUST be preceded by the release install command so the
  `beforePack` guard can fail loudly instead of producing a broken artifact.
- `gh` CLI usage MUST batch requests and respect the user's API rate limit.
- New dependencies MUST be justified in the PR and MUST NOT duplicate a capability an
  existing dependency already provides. Native or platform-specific dependencies MUST be
  checked against the Linux glibc floor and the release install policy.
- User-facing strings MUST go through the i18next catalog so the localization coverage
  gates pass; hardcoded UI text is a violation.
- Secrets, tokens, and account identifiers MUST NOT be committed, logged, or captured in
  transcripts; they MUST flow through the existing secure storage and redaction paths.

## Development Workflow and Quality Gates

- Verification before completion: `pnpm tc` (typecheck), `pnpm test [file]`, and
  `pnpm run check:code-quality:changed` MUST pass on changed files before a change is called
  done; full `pnpm lint` is the CI gate.
- Ratchets are one-way. Adding a `max-lines` disable (any linter, any variant) or a per-file
  `max-lines` bump is prohibited. Direct `child_process` imports, `ts-nocheck`, and
  runtime-electron ratchets MUST NOT regress.
- Design-system lint failures on changed lines are a hard gate; suppressing them requires
  following the style guide's Enforcement section.
- Every PR MUST fill the pull request template for a reviewer who has never seen the code:
  plain-language ELI5, the user-experienced before and after, the mechanism changed, why
  this approach over alternatives, a linked issue, before/after visual proof for UI changes
  (or an explicit `N/A` with reason), and the platforms actually tested.
- PRs MUST be small and focused. Reviewers MUST check security, cross-platform support,
  remote SSH, mobile, backwards compatibility, and performance.
- Worktree safety: all reads and edits use the primary working directory; absolute paths
  from subagent output that point at the main repo MUST NOT be followed.
- Modified launch-policy code MUST be rebuilt before running an app; stale build wrappers
  are not safe.
- Upstream sync: `stablyai/orca` MUST be merged (not rebased) into `main` on a regular
  cadence through a dedicated PR that contains no unrelated changes. Conflicts MUST be
  resolved in favor of upstream unless a documented fork divergence applies.
- Fork divergence record: every intentional departure from upstream (a replaced behavior,
  a removed feature, a changed default) MUST be listed with its reason in a reference
  document under `docs/reference/`, and the PR that introduces it MUST update that list.

## Governance

This constitution supersedes conflicting practice in any other document. Where it is silent,
`AGENTS.md`, `docs/STYLEGUIDE.md`, and the documents under `docs/reference/` apply in that
order, followed by the style guide's own resolution order.

Amendment procedure: an amendment is proposed as a pull request that edits this file,
states the motivating incident or gap, and lists the reference documents or lint gates that
enforce the new rule. A rule that cannot be enforced by a gate, a test, or a documented
review check MUST say so explicitly. The amendment takes effect when the PR merges to
`main`.

Versioning policy: MAJOR for removing or redefining a principle in a backward-incompatible
way; MINOR for adding a principle or section or materially expanding guidance; PATCH for
clarifications, wording, and typo fixes. The version line below MUST be updated in the same
PR as the change, and `Last Amended` MUST be set to the merge-ready date.

Compliance review: every PR review MUST verify the change against Principles I–VI and the
quality gates above. Complexity that violates a principle MUST be justified in the PR's
"Why" section; unjustified violations block merge. Spec, plan, and task artifacts produced
under `.specify/` MUST include a constitution check that cites the principles they touch.

**Version**: 1.1.0 | **Ratified**: 2026-09-23 | **Last Amended**: 2026-09-23
