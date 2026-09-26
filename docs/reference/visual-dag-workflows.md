# Visual DAG Workflows

## Dependencies

- **`@xyflow/react` 12.11.6** (MIT, peer `react >=17`) — the workflow editor canvas. React 19
  compatible; used by Dify, Langflow, Flowise, AutoGen Studio, orca-viz and orca-dag. Its
  stylesheet is imported from the editor component, following the `pdf_viewer.css` and
  `xterm.css` precedents; custom node and edge components use only `main.css` tokens.
- **`@dagrejs/dagre` 3.1.1** (MIT) — synchronous auto-layout for the editor's node graphs;
  sufficient for graphs of tens of nodes.
- **Justified duplication**: `@xyflow/react` bundles Zustand 4 internally while Orca uses
  Zustand 5. That copy is private to the library and does not touch Orca stores.

See `specs/001-visual-dag-workflows/research.md` (R10) for the full alternatives analysis
(Rete.js, tldraw, elkjs) and rationale.

## Plugin provisioning evidence

Captured 2026-09-27 on macOS (darwin) with the CLIs installed on the development machine. Only
`--help` output was run; nothing was installed against the real user configuration. The output
contains no account identifiers.

### Claude Code (`claude --version` → `2.1.283 (Claude Code)`)

`claude plugin --help`:

```text
Usage: claude plugin|plugins [options] [command]

Manage Claude Code plugins

Options:
  -h, --help                           Display help for command

Commands:
  details [options] <name>             Show a plugin's component inventory and
                                       projected token cost
  disable [options] [plugin]           Disable an enabled plugin
  enable [options] <plugin>            Enable a disabled plugin
  eval [options] [target]              Run eval cases (<eval dir>/**/case.yaml
                                       or prompt.md + graders/*.md; the eval dir
                                       is evals/ unless --eval-dir or the
                                       manifest says otherwise) against a plugin
                                       and report scored results. Target is a
                                       path, a plugin name, or a
                                       `plugin@marketplace` id — installed and
                                       skills-dir plugins both resolve (and add
                                       a no-plugin baseline arm). It loads the
                                       plugin and runs its eval suite (prompts,
                                       graders; scaffold scripts and real MCP
                                       servers only when you opt in) on your
                                       machine, as you: only evaluate plugins
                                       you trust — the run's sandboxing limits
                                       what a malicious plugin can reach but is
                                       not a guarantee, and a bundled suite
                                       passing is not a security vetting. The
                                       first run in an untrusted plugin
                                       directory asks you to confirm
                                       (--trust-plugin answers for CI)
  help [command]                       display help for command
  init|new [options] <name>            Scaffold a new plugin at
                                       ~/.claude/skills/<name>/ (auto-loads next
                                       session as <name>@skills-dir)
  install|i [options] <plugin>         Install a plugin from available
                                       marketplaces (use plugin@marketplace for
                                       specific marketplace)
  list [options]                       List installed plugins
  marketplace                          Manage Claude Code marketplaces
  prune|autoremove [options]           Remove auto-installed dependencies that
                                       are no longer needed
  tag [options] [path]                 Create a {name}--v{version} git tag for a
                                       plugin release, validating that
                                       plugin.json and any enclosing marketplace
                                       entry agree
  uninstall|remove [options] <plugin>  Uninstall an installed plugin
  update [options] <plugin>            Update a plugin to the latest version
                                       (restart required to apply)
  validate [options] <path>            Validate a plugin or marketplace
                                       manifest, or the skills, agents, and
                                       commands in a directory
```

`claude plugin install --help`:

```text
Usage: claude plugin install|i [options] <plugin>

Install a plugin from available marketplaces (use plugin@marketplace for
specific marketplace)

Options:
  --accept-command <sha256>  Accept the marketplace-declared command (a
                             command-source install, or the headersHelper that
                             fetches the archive) whose sha256 a previous --json
                             run reported as shownCommand.sha256; counts as -y
                             for exactly that command, for that plugin and
                             marketplace catalog, and nothing else. If either
                             changed (a refresh that moved the catalog counts),
                             the run refuses and reports the command again, to
                             be shown to a person again
  --config <key=value>       Set a userConfig option declared in the plugin's
                             manifest (repeatable). Values are validated against
                             the schema and stored via the same path as the
                             interactive /plugin configure flow.
  -h, --help                 Display help for command
  --json                     Print one machine-readable result line on stdout
                             instead of the human message (same exit codes; a
                             marketplace-declared command is still shown and
                             must be confirmed — pass -y when not interactive)
  --registry <url>           For a <package>@npm install: resolve and download
                             from this npm registry instead of the one your npm
                             configuration selects
  -s, --scope <scope>        Installation scope: user, project, or local
                             (default: "user")
  -y, --yes                  Accept the displayed marketplace-declared command
                             without the confirmation prompt — a plugin
                             installed by running a command, or one whose
                             archive is fetched through a headersHelper command
                             (required when stdin or stdout is not a TTY)
```

`claude plugin list --help`:

```text
Usage: claude plugin list [options]

List installed plugins

Options:
  --available  Include available plugins from marketplaces (requires --json)
  -h, --help   Display help for command
  --json       Output as JSON
```

`claude plugin marketplace --help`:

```text
Usage: claude plugin marketplace [options] [command]

Manage Claude Code marketplaces

Options:
  -h, --help                  Display help for command

Commands:
  add [options] <source>      Add a marketplace from a URL, path, or GitHub repo
  help [command]              display help for command
  list [options]              List all configured marketplaces
  remove|rm [options] <name>  Remove a configured marketplace
  update [options] [name]     Update marketplace(s) from their source - updates
                              all if no name specified
```

**Chosen non-interactive invocation** (host scope = Claude's `user` scope, run on the host that
executes the node):

```sh
claude plugin install <plugin> --scope user
```

- `<plugin>` is the skill's declared source verbatim (`name` or `name@marketplace`); the
  marketplace must already be configured on that host, otherwise the install fails and the node
  fails with the CLI's message.
- `-y` / `--accept-command` are deliberately **not** passed. They accept a marketplace-declared
  command (a command-source install or a headersHelper) without showing it to a person. Trusting
  a plugin source (FR-018a) is not consent to run an arbitrary marketplace command, so such a
  plugin fails in a non-TTY run (the CLI requires `-y` there) and the node's reason tells the
  person to install it manually.
- `--json` is not used: its result-line shape is not documented in `--help`, so success is read
  from the exit code only and the CLI's own output is quoted in failures.
- Presence is verified before and after install by reading `~/.claude/plugins/installed_plugins.json`
  and the Claude settings files on the executing host with the resolution in
  `src/main/skills/claude-plugin-skill-sources.ts` (installed, enabled, and
  `<installPath>/skills/<skill>` exists).

### Codex (`codex --version` → `codex-cli 0.155.1`)

`codex plugin add --help`:

```text
Install a plugin from a configured or remote marketplace.

Pass either `PLUGIN@MARKETPLACE` or pass `PLUGIN` with `--marketplace MARKETPLACE`.

Usage: codex plugin add [OPTIONS] <PLUGIN[@MARKETPLACE]>

Arguments:
  <PLUGIN[@MARKETPLACE]>
          Plugin selector to install: either PLUGIN@MARKETPLACE or PLUGIN with --marketplace

Options:
  -c, --config <key=value>
          Override a configuration value that would otherwise be loaded from `~/.codex/config.toml`.
          Use a dotted path (`foo.bar.baz`) to override nested values. The `value` portion is parsed
          as TOML. If it fails to parse as TOML, the raw string is used as a literal.
          
          Examples: - `-c model="o3"` - `-c 'sandbox_permissions=["disk-full-read-access"]'` - `-c
          shell_environment_policy.inherit=all`

  -m, --marketplace <MARKETPLACE>
          Marketplace name to use when PLUGIN does not include @MARKETPLACE

      --enable <FEATURE>
          Enable a feature (repeatable). Equivalent to `-c features.<name>=true`

      --json
          Output install result as JSON

      --disable <FEATURE>
          Disable a feature (repeatable). Equivalent to `-c features.<name>=false`

  -h, --help
          Print help (see a summary with '-h')

Examples:
  codex plugin add sample@debug
  codex plugin add sample --marketplace debug
```

Codex has a non-interactive `codex plugin add <PLUGIN@MARKETPLACE>`, but Orca has no scanner
that can verify a Codex plugin's skills are present on a host, so Codex stays **verify-only**
for now: a Codex node needing a plugin-sourced skill fails with install instructions rather than
installing something Orca cannot then verify.

### Every other provider

No plugin CLI was verified, so every other agent is **verify-only**: the node fails before launch
with instructions naming the plugin to install on that host.

### Trust scope

Trust (FR-018a) is remembered per source per host in `workflow_source_trust`. The host key is:

| Execution host | Host key |
|---|---|
| The machine the Orca runtime runs on | `local` |
| An SSH workspace | `ssh:<connectionId>` (the SSH target id the repo is bound to) |
| A WSL workspace | `wsl:<distro>` |

A pending trust question is resolved with `workflow.trust.decide { source, host?, decision }`
(`host` defaults to `local`). It records the decision, answers every pending `trust` question for
that source on that host, and wakes the runs waiting on them; each waiting node then re-enters
provisioning through the normal dispatch path and either installs (trusted) or fails (refused).
The same call with the other decision revokes an earlier one.
