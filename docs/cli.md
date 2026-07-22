# CLI Reference

The CLI uses the same search library and result shape as the MCP server. The installed binaries are defined in `package.json`: `agent-session-search`, `agent-session-search-doctor` (also exposed as the `agent-session-search doctor` subcommand), and `agent-session-search-mcp`. Two opt-in binaries ship alongside them and are never enabled automatically: `agent-session-search-native-mcp` (audited raw FFF lane, see `mcp.md`) and `agent-session-search-cass-shim` (cass CLI adapter for cass-memory/cm, see `cass-shim.md`).

## Commands

### Search

```bash
agent-session-search "auth token timeout" --json
agent-session-search "global search" --source codex --source claude --json
agent-session-search --json --group-candidates @payload.json
agent-session-search "auth token timeout" --json --evidence --path /absolute/session.jsonl
agent-session-search "auth token timeout" --json --candidates --debug
agent-session-search "auth token timeout" --json --days 7 --workspace /data/projects/agent-session-search
```

Without `--json`, search output is a short human summary plus warnings. Use `--json` when you need result records. Candidate mode returns `resultsShape: "candidate_groups"`: ordered match groups with compact leads, counts, `hasMore`, optional `more.groupCandidates` group expansion payloads, and per-candidate `more.evidence` payloads.

Options:

| Option                                 | Use                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--json`                               | Print the full result object.                                                                                   |
| `--source <source>`                    | Restrict search to one source. Repeat for multiple sources.                                                     |
| `--probe <query>` / `--query <query>`  | Add planned probes mapped to MCP `queries`. These do not replace the required positional search query.          |
| `--cwd <path>`                         | Add cwd to `operationalContext`.                                                                                |
| `--branch <name>`                      | Add branch to `operationalContext`.                                                                             |
| `--reason <text>`                      | Add reason to `operationalContext`.                                                                             |
| `--group-candidates <json\|@file\|->`  | Replay a server-prepared `more.groupCandidates` payload to expand one candidate group.                          |
| `--mode <candidates\|evidence\|debug>` | Select result detail. Defaults to `candidates`, unless `--debug` is used alone.                                 |
| `--candidates`                         | Return candidate groups with compact session-level leads. Combine with `--debug` for ranking diagnostics.       |
| `--evidence`                           | Return evidence groups or focused evidence hits.                                                                |
| `--debug`                              | Include diagnostics. Alone, this selects debug mode; use `--candidates --debug` for `debug.ranking.candidates`. |
| `--path <path>`                        | Restrict evidence to a canonical session path. Repeatable. This does not imply `--evidence`.                    |
| `--max-patterns <n>`                   | Limit expanded literal patterns.                                                                                |
| `--max-results <n>`                    | Limit results per source. Alias: `--max-results-per-source`. Must be a positive integer.                        |
| `--days <n>`                           | Keep sessions inside a rolling mtime window. Must be a positive integer.                                        |
| `--workspace <path>`                   | Keep sessions associated with one workspace; relative paths resolve against the CLI process cwd.                |

Session filters are deterministic drops applied before result caps, not ranking hints. The days filter computes a rolling mtime window for each invocation and keeps files on or newer than the inclusive cutoff; when `--days` is active, an unstatable session file is dropped. Workspace matching uses physical path containment, an exact dash-encoded segment as an encoded-directory component (never a prefix), or bounded metadata from a recorded `cwd`/`projectRoot` within the workspace. Physical workspace containment and metadata matches include workspace subdirectories. Relative paths resolve against the CLI process cwd, while MCP clients and shims should pass absolute paths. When both flags are present, a session must pass both.

Dash encoding is intentionally lossy: separator punctuation collapses to dashes. Exact segment boundaries prevent sibling and worktree prefix matches, but a residual punctuation collision can still make distinct workspace spellings share an encoded segment. Metadata is the final fallback for eligible text sources, not an unbounded transcript scan.

An empty workspace-filtered search reports `workspace_unknown` when no session under the resolved roots is associated with the checked canonical path. Verify the path in its `recommendedAction` and retry. If the workspace is known but the query or other active filters leave no results, the search instead reports `filters_removed_all_results`.

For group expansion in the CLI, save the exact `more.groupCandidates` object from a candidate group and pass it back unchanged:

```bash
agent-session-search --json --group-candidates @payload.json
```

Use `-` instead of `@payload.json` to read the payload JSON from stdin.

`--path` is normally used with `--evidence`. Path-restricted evidence bypasses the default unscoped evidence cap, but an explicit `--max-results` still applies.

### Help And Version

```bash
agent-session-search help
agent-session-search --help
agent-session-search -h
agent-session-search --version
agent-session-search version
```

### Capabilities

```bash
agent-session-search capabilities --json
agent-session-search capabilities
agent-session-search --json --help
```

Prints the machine-readable CLI and MCP contract, including commands, result modes, contract/version metadata, warning meanings, copy-ready examples for default `candidate_groups`, group expansion, focused evidence, environment variables, and exit-code categories.

### Sources

```bash
agent-session-search sources --json
agent-session-search sources
```

Inspects configured source roots without running a search. Each source includes `enabled`, `status`, `include`, and warning fields, plus the config path used.

If a search uses an unknown `--source` or the source filter matches no enabled roots, the JSON warning includes enabled source names and a `recommendedAction` that points back to `agent-session-search sources --json`. Unknown close-name typos also include a suggested enabled source. Missing or unreadable root warnings include `recommendedAction` guidance to create the directory, fix permissions, or update or disable the source.

### Agent Guides

```bash
agent-session-search robot-docs guide
agent-session-search --robot-triage
```

`robot-docs guide` prints a paste-ready guide for coding agents. `--robot-triage` prints JSON quick reference, recommended commands, and health checks.

## Doctor

The doctor preflight is available both as the `agent-session-search doctor` subcommand and as the standalone `agent-session-search-doctor` binary. Both forms accept the same flags and produce the same output and exit codes.

```bash
agent-session-search doctor
agent-session-search doctor --json
agent-session-search-doctor
agent-session-search-doctor --json --skip-smoke
agent-session-search-doctor --skip-smoke
agent-session-search-doctor --ensure-fff --yes
agent-session-search-doctor --list-orphans
agent-session-search-doctor --json --list-orphans
agent-session-search-doctor --reap-orphans
agent-session-search-doctor --command /usr/local/bin/fff-mcp --skip-smoke
```

Doctor verifies that `fff-mcp` is on `PATH`, requires at least `v0.9.6`, and runs a live smoke test unless `--skip-smoke` is set. It reports the installed version, documented stable release guidance, `multi_grep` support, recall-equivalence status, and the non-destructive upgrade command.

Use `agent-session-search-doctor --json` for agent-driven setup diagnostics. JSON success writes one parseable object to stdout with `ok: true`, `contractVersion: "1.0"`, backend identity fields, stable `checks`, `sourceDiagnostics`, and `orphans`. Parse errors and runtime failures write one parseable object to stderr with `ok: false`, `error.code`, and `exitCode`; stdout stays empty.

Compact success excerpt with `checks` shortened; actual success output includes the full check list for command, version, smoke, multi-grep availability, and recall equivalence:

```json
{
  "tool": "agent-session-search-doctor",
  "contractVersion": "1.0",
  "ok": true,
  "command": "fff-mcp",
  "resolvedPath": "/usr/local/bin/fff-mcp",
  "version": "fff-mcp 0.9.6",
  "requiredRelease": "v0.9.6",
  "recommendedRelease": "v0.9.6",
  "installCommand": "curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash",
  "checks": [
    {
      "id": "command_found",
      "status": "passed",
      "message": "fff-mcp was found."
    }
  ],
  "sourceDiagnostics": {
    "configPath": "/home/user/.config/agent-session-search/config.json",
    "sources": [],
    "warnings": []
  },
  "orphans": null
}
```

Minimal error shape:

```json
{
  "tool": "agent-session-search-doctor",
  "contractVersion": "1.0",
  "ok": false,
  "error": {
    "code": "user_input_error",
    "message": "Unknown option: --wat",
    "suggestedCommand": "agent-session-search-doctor help"
  },
  "checks": [],
  "sourceDiagnostics": null,
  "orphans": null,
  "exitCode": 1
}
```

Doctor does not install or upgrade automatically. Use `agent-session-search-doctor --ensure-fff --yes` when you explicitly want doctor to run the official installer.

Use `--list-orphans` before `--reap-orphans`. In JSON mode, `--json --list-orphans` adds `orphans.mode: "list"` and `found`; `--json --reap-orphans` adds `orphans.mode: "reap"`, `found`, `reaped`, and `failed`. Reaping kills matching orphaned `fff-mcp` processes with `SIGKILL`; it does not prompt.

Doctor parse errors fail before preflight. Unknown options print usage and a safe next command when a close flag spelling can be corrected.

## MCP Server

```bash
agent-session-search-mcp
```

Runs the stdio MCP server that exposes `search_sessions`.

## Exit Codes

| Code | Meaning                                                     |
| ---- | ----------------------------------------------------------- |
| `0`  | Success.                                                    |
| `1`  | User-input error, such as a missing query or invalid flag.  |
| `3`  | Tool-environment error, such as missing or stale `fff-mcp`. |
| `4`  | Unexpected upstream failure.                                |

With `--json`, CLI parse failures write a JSON envelope to stderr with `error.code: "user_input_error"` and `suggestedCommand`.
Doctor JSON uses the same stream and exit-code rules: success stdout with exit `0`, user-input errors stderr with exit `1`, tool-environment errors such as missing or stale `fff-mcp` stderr with exit `3`, and upstream failures stderr with exit `4`.
