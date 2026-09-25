# Plan research: conventions (part 1)

Not in repo: JSON schema for orca.yaml; renderer bundle-size budget; the `$electron` skill AGENTS.md mentions; .nvmrc/.node-version.

## A.1 orca.yaml
- Parser: `src/shared/orca-yaml.ts` uses `yaml` package (`parseDocument`, yaml ^2.8.4). Limits in `src/shared/orca-yaml-file-limit.ts`. Hook types `src/shared/orca-yaml-hook-types.ts`.
- Unknown top-level keys: `src/main/hooks.ts` `RECOGNIZED_ORCA_YAML_KEYS = new Set(['scripts','setupAgentStartupPolicy','issueCommand','defaultTabs','environmentRecipes','worktree'])`; `hasUnrecognizedOrcaYamlKeys(repoPath)` line-regex; UI suggests update. A new top-level key must be added to this set.
- Local reads: `loadHooks(path)`/`hasHooksFile` sync readFileSync. SSH: `src/main/runtime/runtime-repository-hooks-commands.ts:31-42,77-89,119-124` reads via `getSshFilesystemProvider(repo.connectionId).readFile(joinWorktreeRelativePath(repo.path,'orca.yaml'))` then `parseOrcaYaml` locally. `runtime-repository-issue-command.ts` (`readRemoteShared`) same. Folder repos via `isFolderRepo(repo)` (`src/shared/repo-kind`).

## A.2 `.orca/` in a repo = per-user, git-ignored, never committed
- `src/main/issue-command-file.ts:1` comment: `.orca/issue-command` is per-user override; `orca.yaml` is tracked default.
- `.orca/issue-command` written by `issue-command-file.ts` (local), `runtime-repository-issue-command.ts:73-90`, `ipc/hooks/register-worktree-hook-file-handlers.ts:36,96,112` (SSH via fsProvider).
- `.orca/drops` (file drops), `.orca/templates` (markdown templates).
- `ensureOrcaDirIgnored` (`issue-command-file.ts:114-129`) and `ensureRemoteOrcaDirIgnored` (`runtime-repository-issue-command.ts:120-146`) APPEND `.orca` to the repo `.gitignore` (creating it), after `isIssueCommandIgnoredByGit` (`git/check-ignored-paths`).
- Only committed Orca-owned file: `orca.yaml`. No committed per-project directory exists. A committed workflow file under `.orca/` clashes with auto-ignore.

## A.3 `~/.orca/`
- `keybindings/keybinding-file.ts:28` -> `~/.orca/keybindings.json`; credential stores (linear, minimax, bitbucket...).

## A.3 ~/.orca/ (full)
- keybindings `~/.orca/keybindings.json`; credential stores (linear, minimax, bitbucket, speech openai) under `~/.orca`; `~/.orca/agent-hooks/`; `~/.orca/claude-agent-teams-bin`; orcad uses XDG `Orca` else `~/.orca`; relay: `~/.orca/sessions`, `~/.orca-remote/terminal-history`, `~/.orca-relay`.

## A.4 gitignore handling
- Nothing writes `.git/info/exclude` (only a test fixture). `.gitignore` changed in: `issue-command-file.ts:114-129` (append `.orca`), `runtime-repository-issue-command.ts:120-146` (SSH), `git/huge-folder-ignore.ts:44-65` (validated folder names only). Regex `/^\.orca\/?$/m`. A committed file under `.orca/` would be hidden.

## B.5 Vitest
- `config/vitest.config.ts`: env node; DOM tests opt in with `/** @vitest-environment happy-dom */`; include `src/**/*.test.ts(x)`, `config/scripts/**/*.test.{ts,mjs}`, `tests/tools/**/*.test.mjs`, `tests/e2e/**/*.unit.test.ts`; setupFiles happy-dom-offscreen-canvas, mutation-observer-retention, vitest-host-ports-setup; testTimeout 30s; aliases `@`, `@renderer` -> src/renderer/src.
- SQLite tests: `new OrchestrationDb(':memory:')`, `Database from '../../sqlite/sync-database'`; migrations `src/main/runtime/orchestration/db/schema/migrate-v*.ts` (e.g. v40 `ALTER TABLE ... ADD COLUMN ... DEFAULT ''`); migration tests exist. Caveat: wildcard SELECTs never statement-cached.
- Renderer tests: `@testing-library/react ^16.3.2` (~444 files) or manual `createRoot` + `act`; wrap in TooltipProvider; seed `useAppStore`.
- RPC method tests: `eraseRpcMethods(METHODS).find(c => c.name === name)`, `method.handler(params, { runtime })` with mocked runtime; assert `!isStreamingMethod`.

## B.6 Electron UI validation
- No `$electron` skill in repo. `ORCA_BACKGROUND_LAUNCH` in `src/main/window/foreground-activation-policy.ts`; scripts `config/scripts/run-electron-vite-dev.mjs`, `terminal-e2e-helpers.mjs` (cdpPort), `tests/tools/benchmarks/workspace-switch-paint-latency.mjs` (Playwright chromium attach to CDP); `tests/playwright.config.ts` projects electron-headless/headful; @playwright/test ^1.59.1.

## B.7 Ratchets
- max-lines: `.oxlintrc.json:160-178` .ts 300, .tsx 400, .mjs 600, tests 800 (blank/comments skipped); baseline `config/max-lines-baseline.txt`; fix = split file.
- runtime-electron: new module reachable from `src/main/runtime/orca-runtime.ts`, `runtime-rpc.ts`, `orcad/main.ts` must not import `electron` (baseline `config/runtime-electron-baseline.txt`).
- ts-nocheck ratchet; child_process ratchet (`src/shared/child-process/child-process-import-boundary.test.ts`, allowlist fixture) -> use runProcess/spawnProcess.
- `check-changed-code-quality.mjs`: oxlint scans (root, casting, native plugins, type-aware, React Doctor, design-system on added lines); SAFETY note on type-assertion disables; anti-slop check.

## B.8 Dead code, deps, bundling
- `config/knip.json`: entries main/preload/renderer (`src/renderer/src/main.tsx`, popout, web/main.tsx, workers), cli, relay, config/scripts, tests; project `src/**/*.{ts,tsx}`; ignore mobile/out/dist; ignoreDependencies electron, @types/*.
- `docs/reference/pnpm-install-policy.md` only covers native/optional deps. No policy doc for pure-JS renderer deps; no renderer bundle-size budget.
- Bundling: root `electron.vite.config.ts`, `config/electron-vite-target.config.cts`, `vite.web.config.ts` (web/mobile-web renderer), `config/build-plugins/`.

## C.9 Versions
electron 43.7.0; react/react-dom ^19.2.8; vite npm:rolldown-vite@7.3.1; electron-vite ^5.0.0; tailwindcss ^4.2.4; zod ~4.5.4; zustand ^5.0.14; i18next ^26.3.1; react-i18next 17.0.13; typescript ^7.0.2; vitest ^4.1.11; oxlint ^1.80.0; yaml ^2.8.4; engines node 24; pnpm@12.0.0. No graph/canvas lib installed.

## C.10 mermaid / dnd-kit
- mermaid ^11.17.2 only for markdown/code-block rendering (`components/editor/mermaid-*`); mobile builds its own mermaid webview.
- @dnd-kit/core ^6.3.1 only for tab drag/split (`components/tab-group/*`). Nothing canvas-like.

## D.11 Mobile
- Expo ^55, react-native ^0.83.10, react ^19.2.8; own vitest/oxlint/tsc/oxfmt; knip ignores it.
- Shares `src/shared` via RELATIVE imports (~467 files, e.g. `from '../../../src/shared/github/comment-types'`); `mobile/metro.config.js` watchFolders adds sharedRoot; tsconfig paths `@/*` -> ./src/*. Any src/shared module mobile imports must be RN-safe (no node:/electron).

## E.12 CLI group (automations example)
- Spec `src/cli/specs/automations.ts`: `CommandSpec[]` `{ path: ['automations','list'], summary, usage, allowedFlags: [...GLOBAL_FLAGS], positionalArgs?, examples, notes? }`; registered in `src/cli/specs/index.ts:28`.
- Handlers `src/cli/handlers/automations.ts:161`: `AUTOMATION_HANDLERS: Record<string, CommandHandler>`; `client.call<T>('automation.list')`, `printResult(result, json, formatter)`; helpers from `../dispatch`, `../flags`, `../format`, `RuntimeClientError('invalid_argument', ...)` from `../runtime-client`.
- Lazy load `src/cli/handler-group-manifest.ts` `{ name, keys, load }`. Help `src/cli/root-help-text-primary.ts:45-51`; `src/cli/vocabulary-policy.ts:21`.
- RPC `src/main/runtime/rpc/methods/automations.ts`: `AUTOMATION_METHODS = [ defineMethod({ name: 'automation.list', params: AutomationList, handler: (params, { runtime }) => runtime.listAutomationsForScope(params) }) ]`; zod params in `automation-schemas.ts`; registered `rpc/methods/index.ts:60`. RPC names singular, CLI plural. Capabilities in `src/shared/protocol-version.ts` (e.g. `AUTOMATION_OWNER_FENCING_RUNTIME_CAPABILITY`) checked via `context.clientCapabilities`.
- Tests: `src/cli/index-automation-identifiers.test.ts` (`main([...], '/tmp/repo')`), `src/cli/handlers/automation-*.test.ts`.
