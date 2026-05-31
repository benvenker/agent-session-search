# Agent Session Search

<div align="center">

```text
+------------------------+      +--------------------+      +-----------------------+
| Codex / Claude / Pi    |      | agent-session-     |      | canonical session     |
| Cursor / Hermes / Pool | ---> | search             | ---> | paths + evidence      |
+------------------------+      +--------------------+      +-----------------------+
```

[![npm](https://img.shields.io/npm/v/@benvenker/agent-session-search.svg)](https://www.npmjs.com/package/@benvenker/agent-session-search)
[![license](https://img.shields.io/npm/l/@benvenker/agent-session-search.svg)](./LICENSE)
![node](https://img.shields.io/badge/node-%3E%3D22.12.0-339933)

Local MCP server and CLI for searching coding-agent session history across Codex, Claude Code, Cursor, Pi, Hermes, Pool, and custom transcript roots.

</div>

```bash
npm install -g @benvenker/agent-session-search && curl -L https://dmtrkovalenko.dev/install-fff-mcp.sh | bash
```

Review the FFF installer before piping it to a shell: <https://dmtrkovalenko.dev/install-fff-mcp.sh>.

## TL;DR

### The Problem

Coding-agent work is scattered. A single feature may span a Codex thread, a Claude Code retry, a Cursor transcript, a Pi session, and a Pool trajectory. Weeks later, you remember the error message or branch name, but not which agent saw it.

### The Solution

Agent Session Search wraps [FFF][fff] and exposes one agent-facing MCP tool, `search_sessions`, plus a matching CLI. It searches the raw transcript files already on disk, keeps canonical absolute paths in results, and returns compact candidates first so agents can ask for evidence only when needed.

[fff]: https://dmtrkovalenko.dev/blog/just-build-fast-tools

### Why Use Agent Session Search?

| Need                      | What you get                                        | Example                                                  |
| ------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| Cross-agent recall        | One query across enabled roots                      | `agent-session-search "auth token timeout" --json`       |
| Agent-native MCP          | One public tool: `search_sessions`                  | `{ "query": "Find PR 227 work", "sources": "all" }`      |
| Fast local lexical search | FFF does the searching                              | No embeddings, no hosted service, no background database |
| Focused follow-up         | Candidate results include `more.evidence`           | Echo the payload to get snippets for one session         |
| Inspectable paths         | Canonical absolute `path`, `source`, and `root`     | Open the exact transcript file that matched              |
| Partial success           | Missing roots warn without killing the whole search | `missing_root`, `unreadable_root`, and partial results   |

## Quick Example

```bash
# Verify that the FFF backend is reachable.
agent-session-search-doctor

# Inspect which sources are enabled on this machine.
agent-session-search sources --json

# Search all enabled session roots.
agent-session-search "auth token timeout" --json

# Add literal probes and operational context when an agent knows more.
agent-session-search "Find PR 227 work" --json \
  --probe "PR #227" \
  --probe paper-cuts \
  --cwd /repo \
  --branch paper-cuts \
  --reason "Recover prior context"

# Restrict a search to specific sources.
agent-session-search "auth token timeout" --source codex --source claude --json

# Inspect candidate ranking when an order looks surprising.
agent-session-search "auth token timeout" --json --candidates --debug

# Pull focused evidence from a selected candidate path.
agent-session-search "auth token timeout" --json --evidence \
  --path /Users/ben/.codex/sessions/session.jsonl
```

## Design Philosophy

| Principle         | Meaning                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| One MCP tool      | Keep the public surface centered on `search_sessions`; use modes and follow-up payloads instead of extra tools.   |
| FFF is the engine | No custom indexing, embeddings, SQLite stores, or markdown session exports. Raw files remain the source of truth. |
| Candidates first  | Default output is compact session-level leads. Evidence is a deliberate second step.                              |
| Canonical paths   | Results preserve absolute paths plus `source` and `root` metadata so agents can inspect real files.               |
| Partial success   | A broken or missing source root emits warnings while other roots still return results.                            |

## Comparison

| Approach              | Best for                                        | Tradeoff                                                               |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| Agent Session Search  | Agent recall across many local transcript roots | Lexical only; it will not find concepts that never appear as text      |
| `grep` / `rg` scripts | One-off proof searches in known directories     | You have to remember every root, format, and include pattern yourself  |
| `fff-mcp` directly    | Fast search inside one chosen directory         | No cross-source fanout, result shaping, or candidate/evidence workflow |
| Vector memory systems | Semantic recall and summarization               | More moving parts, derived state, and often a higher privacy/ops cost  |
| Per-agent history UIs | Browsing one agent's own history                | Usually misses work done in other tools                                |

## Installation

### 1. npm Global Install

```bash
npm install -g @benvenker/agent-session-search
agent-session-search-doctor
```

If `fff-mcp` is missing and npm is running in an interactive terminal, the package postinstall prompts before running the FFF installer. In non-interactive installs it prints the command instead.

### 2. Install The FFF Backend Manually

```bash
curl -L https://dmtrkovalenko.dev/install-fff-mcp.sh | bash
agent-session-search-doctor
```

### 3. From Source

```bash
git clone https://github.com/benvenker/agent-session-search.git
cd agent-session-search
nvm use
npm install
npm run build
npm run dev:cli -- "auth token timeout" --json
```

### 4. Local Package Tarball

```bash
npm pack --dry-run --json
tmpdir="$(mktemp -d)"
npm pack --pack-destination "$tmpdir"
mkdir "$tmpdir/app"
cd "$tmpdir/app"
npm init -y
npm install --foreground-scripts --no-audit --no-fund "$tmpdir"/agent-session-search-*.tgz
npx agent-session-search-doctor
npx agent-session-search "auth token timeout" --json
```

Node `>=22.12.0` is required. The repo `.nvmrc` selects Node 24 LTS.

## Quick Start

1. Install the package and FFF.

```bash
npm install -g @benvenker/agent-session-search
agent-session-search-doctor
```

2. Search with the CLI.

```bash
agent-session-search "auth token timeout" --json
```

3. Register the MCP server with a client.

```json
{
  "mcpServers": {
    "agent-session-search": {
      "command": "agent-session-search-mcp"
    }
  }
}
```

4. Call the tool from an agent.

```json
{
  "query": "Find the prior session about PR 227 and the papercuts branch.",
  "queries": ["PR #227", "paper-cuts", "poolside-studio pull 227"],
  "operationalContext": {
    "cwd": "/Users/ben/code/poolside/poolside-studio",
    "branch": "paper-cuts",
    "reason": "Recover the prior session that worked on this PR."
  },
  "sources": "all"
}
```

Use `query` for the concise recall task. Put short literal probes in `queries`. Put cwd, branch, repo, and reason in `operationalContext` so useful context does not pollute the search text.

## MCP Tool

The server exposes one tool: `search_sessions`.

Minimal input:

```json
{
  "query": "auth token timeout",
  "sources": "all",
  "resultsDisplayMode": "candidates",
  "maxResultsPerSource": 20
}
```

Input fields:

| Field                 | Use                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `query`               | Concise human-readable recall task. Avoid output-format instructions and examples.                  |
| `queries`             | Optional short literal search probes planned by the caller.                                         |
| `operationalContext`  | Optional cwd, repo, branch, recent chat, or reason for the search.                                  |
| `sources`             | Optional array such as `["codex", "claude"]`, or `sources: "all"` for every enabled root.           |
| `resultsDisplayMode`  | `candidates`, `evidence`, or `debug`. Defaults to `candidates`.                                     |
| `paths`               | Restrict evidence results to canonical session paths from a candidate.                              |
| `maxPatterns`         | Limit expanded literal search patterns.                                                             |
| `maxResultsPerSource` | Limit backend hits considered per source.                                                           |
| `context`             | Reserved for backend support; current FFF results are bounded snippets, not surrounding-line reads. |
| `debug`               | Include query expansion and diagnostics. Candidate debug includes `debug.ranking.candidates`.       |

### Candidates First, Evidence Follow-Up

By default, `search_sessions` returns compact session-level candidates grouped by `source` and `path`. A candidate includes a short `preview`, `hitCount`, matched patterns, and a complete `more.evidence` follow-up request.

The agent can echo that `more.evidence` object back to the same tool to get matching snippets from one selected session. No second MCP tool is needed.

Unscoped `evidence` mode returns grouped session evidence with representative snippets. Path-restricted evidence returns raw evidence hits for selected canonical paths and bypasses the default per-source cap so a selected session is not lost behind unrelated matches.

## Command Reference

### `agent-session-search help`

```bash
agent-session-search help
agent-session-search --help
agent-session-search -h
```

Print CLI help.

### `agent-session-search --version`

```bash
agent-session-search --version
agent-session-search version
```

Print the installed package version.

### `agent-session-search "<query>"`

```bash
agent-session-search "auth token timeout" --json
agent-session-search "global search" --source codex --source claude
agent-session-search "auth token timeout" --json --mode <candidates|evidence|debug>
```

Run a search through the same code path used by the MCP server.

Common options:

| Option                                 | Example                                            | Use                                                                      |
| -------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| `--json`                               | `agent-session-search "auth token timeout" --json` | Print the full result object.                                            |
| `--source <source>`                    | `--source codex --source claude`                   | Restrict search to one or more sources.                                  |
| `--probe <query>` / `--query <query>`  | `--probe "PR #227"`                                | Add literal probes, mapping to MCP `queries`.                            |
| `--cwd <path>`                         | `--cwd /repo`                                      | Add cwd to `operationalContext`.                                         |
| `--branch <name>`                      | `--branch paper-cuts`                              | Add branch to `operationalContext`.                                      |
| `--reason <text>`                      | `--reason "Recover prior context"`                 | Add reason to `operationalContext`.                                      |
| `--mode <candidates\|evidence\|debug>` | `--mode evidence`                                  | Select result detail.                                                    |
| `--candidates`                         | `--candidates --debug`                             | Return compact leads; with debug, include ranking details.               |
| `--evidence`                           | `--evidence --path /absolute/session.jsonl`        | Return snippets or focused raw hits.                                     |
| `--debug`                              | `--debug`                                          | Return diagnostics; with candidates, include `debug.ranking.candidates`. |
| `--path <path>`                        | `--path /Users/ben/.codex/sessions/session.jsonl`  | Restrict evidence to a canonical session path.                           |
| `--max-patterns <n>`                   | `--max-patterns 8`                                 | Limit expanded literal patterns.                                         |
| `--max-results <n>`                    | `--max-results 20`                                 | Limit results per source; `--max-results-per-source` also works.         |

JSON output includes `query`, `resultsDisplayMode`, `resultsShape`, `expandedPatterns`, `searchedSources`, `warnings`, `results`, and optional `debug.ranking.candidates`.

### `agent-session-search capabilities --json`

```bash
agent-session-search capabilities --json
agent-session-search --json --help
```

Print the machine-readable CLI and MCP contract, including commands, modes, environment variables, and exit codes.

### `agent-session-search sources --json`

```bash
agent-session-search sources --json
```

Inspect configured source roots without running a search. The payload includes each source's enabled, status, include, and warning fields, plus the config path used.

### `agent-session-search robot-docs guide`

```bash
agent-session-search robot-docs guide
```

Print a paste-ready guide for coding agents.

### `agent-session-search --robot-triage`

```bash
agent-session-search --robot-triage
```

Print JSON quick reference, recommended commands, and health checks for agents.

### `agent-session-search-doctor`

```bash
agent-session-search-doctor
agent-session-search-doctor --skip-smoke
agent-session-search-doctor --list-orphans
agent-session-search-doctor --reap-orphans
agent-session-search-doctor --command /usr/local/bin/fff-mcp --skip-smoke
```

Verify that `fff-mcp` is on `PATH`, run a live smoke test unless skipped, and optionally list or reap orphaned `fff-mcp` processes from crashed sessions.

### `agent-session-search-mcp`

```bash
agent-session-search-mcp
```

Run the stdio MCP server that exposes `search_sessions`.

## Configuration

The default config path is:

```text
~/.config/agent-session-search/config.json
```

Override it with `AGENT_SESSION_SEARCH_CONFIG`.

Built-in defaults cover these source names:

| Source     | Default root                             | Notes                                             |
| ---------- | ---------------------------------------- | ------------------------------------------------- |
| `"codex"`  | `~/.codex`                               | Includes live `sessions` and `archived_sessions`. |
| `"claude"` | `~/.claude/projects`                     | Claude Code project transcripts.                  |
| `"pi"`     | `~/.pi/agent/sessions`                   | Pi session records.                               |
| `"cursor"` | `~/.cursor/projects`                     | Cursor agent transcript paths.                    |
| `"hermes"` | `~/.hermes/sessions`                     | Hermes session records.                           |
| `"pool"`   | `~/Library/Application Support/poolside` | Shared Pool CLI and Poolside Studio history root. |

Configured roots with the same name replace built-ins. Set `"enabled": false` to disable a root without deleting it. `include` patterns filter returned paths: slashless patterns such as `"*.jsonl"` match basenames anywhere under the root, while patterns containing `/` match root-relative paths.

Commented example:

```jsonc
{
  "roots": [
    {
      "name": "codex",
      "path": "/Users/ben/.codex",
      "include": [
        "sessions/*.jsonl",
        "sessions/**/*.jsonl",
        "archived_sessions/*.jsonl",
        "archived_sessions/**/*.jsonl",
      ],
    },
    {
      "name": "claude",
      "path": "/Users/ben/.claude/projects",
      "include": ["*.jsonl"],
    },
    {
      "name": "pi",
      "path": "/Users/ben/.pi/agent/sessions",
      "include": ["*"],
    },
    {
      "name": "cursor",
      "path": "/Users/ben/.cursor/projects",
      "include": [
        "*/agent-transcripts/**/*.jsonl",
        "*/agent-transcripts/**/*.json",
      ],
    },
    {
      "name": "hermes",
      "path": "/Users/ben/.hermes/sessions",
      "include": ["*"],
    },
    {
      "name": "pool",
      "path": "/Users/ben/Library/Application Support/poolside",
      "include": [
        "trajectories/*.ndjson",
        "logs/*.log",
        "sessions/*.json",
        "acp/**/*.json",
      ],
    },
  ],
  "synonyms": {
    "auth": ["authentication", "login"],
    "timeout": ["timed out", "deadline"],
  },
  "defaults": {
    "maxPatterns": 8,
    "maxResultsPerSource": 50,
    "context": 0,
  },
}
```

The real file is JSON, so remove comments if you add any.

### Adding another agent

The built-in source names are not a closed list. If another agent writes transcripts as text, add a root:

```json
{
  "roots": [
    {
      "name": "goose",
      "path": "/Users/ben/.goose/sessions",
      "include": ["*.jsonl"]
    }
  ]
}
```

You do not need to re-declare the built-ins to add a new source. They stay enabled unless overridden by name or disabled with `"enabled": false`.

This works for text formats such as JSONL, plain text, Markdown, NDJSON, or logs. It does not work for agents that store sessions only in SQLite databases or binary blobs.

## MCP Client Setup

Most MCP clients can use this stdio entry:

```json
{
  "mcpServers": {
    "agent-session-search": {
      "command": "agent-session-search-mcp",
      "env": {
        "AGENT_SESSION_SEARCH_CONFIG": "/Users/ben/.config/agent-session-search/config.json"
      }
    }
  }
}
```

If the client does not put the npm global bin directory on `PATH`, use the absolute path printed by:

```bash
which agent-session-search-mcp
```

For Pool:

```bash
pool mcp add agent-session-search -- agent-session-search-mcp
pool mcp list
```

Pool stores personal MCP server settings in `~/.config/poolside/settings.yaml` and can also read project-scoped settings from `.poolside/settings.yaml`. Command-based MCP servers inherit the environment of the `pool` process, so `AGENT_SESSION_SEARCH_*` variables work there too.

## Architecture

```text
agent or CLI query
  |
  v
search_sessions / agent-session-search
  |
  +--> load config and resolve enabled roots
  |
  +--> expand agent-planned queries or deterministic literal patterns
  |
  +--> fan out to one fff-mcp child per source root
  |      |
  |      +--> codex  -> ~/.codex/{sessions,archived_sessions}
  |      +--> claude -> ~/.claude/projects
  |      +--> pi     -> ~/.pi/agent/sessions
  |      +--> cursor -> ~/.cursor/projects
  |      +--> hermes -> ~/.hermes/sessions
  |      +--> pool   -> ~/Library/Application Support/poolside
  |      +--> custom -> configured text transcript root
  |
  +--> normalize hits to canonical absolute paths
  |
  +--> rank candidates by recency, hit density, project matches,
  |    and Codex current-session demotion via CODEX_THREAD_ID
  |
  v
compact candidates, grouped evidence, raw evidence hits, warnings, debug data
```

Key modules:

| Module                         | Responsibility                                                         |
| ------------------------------ | ---------------------------------------------------------------------- |
| `src/roots.ts`                 | Built-in roots, config loading, source enablement, path normalization. |
| `src/query-rewriter.ts`        | Deterministic literal probe generation.                                |
| `src/fff-backend.ts`           | FFF child calls and backend result adaptation.                         |
| `src/client-pool.ts`           | FFF child lifecycle and reuse.                                         |
| `src/search.ts`                | Fanout, filtering, ranking, grouping, response shaping.                |
| `src/tool.ts` / `src/types.ts` | MCP input/output contracts.                                            |
| `src/server.ts`                | MCP server entry point.                                                |
| `src/cli.ts` / `src/help.ts`   | CLI commands and agent-readable help.                                  |
| `src/fff-preflight.ts`         | Doctor command and FFF health checks.                                  |

## Warnings And Troubleshooting

| Symptom                              | Meaning                                                   | Fix                                                                                                          |
| ------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `fff-mcp` not found                  | The FFF backend is not on `PATH`.                         | Run `curl -L https://dmtrkovalenko.dev/install-fff-mcp.sh \| bash`, then `agent-session-search-doctor`.      |
| `missing_root`                       | A configured or built-in source directory does not exist. | Run `agent-session-search sources --json`; disable the root or create/update the path.                       |
| `unreadable_root`                    | The source exists but cannot be read.                     | Fix filesystem permissions or remove the root from config.                                                   |
| `unknown_source`                     | A requested `--source` is not configured or is disabled.  | Check enabled names with `agent-session-search sources --json`; omit `--source` to search all enabled roots. |
| `no_sources_selected`                | Filters excluded every enabled source.                    | Remove the filter or choose one of the enabled sources.                                                      |
| `all_sources_failed`                 | Every attempted source failed and no results were found.  | Use the warning's concrete `rg` fallback command for exhaustive proof-style search.                          |
| Broad evidence is capped             | Unscoped `evidence` mode is intentionally bounded.        | Start with candidates, then pass a candidate `more.evidence` payload or use `--path`.                        |
| Current Codex session ranks too high | The active transcript contains the search text.           | Ensure `CODEX_THREAD_ID` is available so matching current-session candidates are demoted.                    |
| Old `fff-mcp` children linger        | A prior client crashed.                                   | Inspect with `agent-session-search-doctor --list-orphans`; clean with `--reap-orphans`.                      |

Missing or unreadable roots are normal on machines that do not use every supported agent. They produce warnings and partial results rather than failing the whole search.

## Environment Variables

All environment variables are optional.

| Variable                                        | Use                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AGENT_SESSION_SEARCH_CONFIG`                   | Override the JSON source-root config path.                                                                    |
| `AGENT_SESSION_SEARCH_FFF_DB_DIR`               | Directory containing FFF `frecency.mdb` and `history.mdb`; set only for a non-default FFF database directory. |
| `AGENT_SESSION_SEARCH_FFF_TIMEOUT_MS`           | Per-pattern FFF timeout in milliseconds. Runtime searches default to `15000`.                                 |
| `AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_ATTEMPTS` | Retry count for initially empty FFF responses.                                                                |
| `AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_DELAY_MS` | Delay between empty-result retries.                                                                           |
| `CODEX_THREAD_ID`                               | Demote the matching current Codex session in candidate ranking.                                               |

For MCP clients, put these in the server entry's `env` block. For CLI use, export them in your shell.

## Limitations

| Limitation            | Consequence                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Lexical search only   | It will not find "retry logic" if the matching transcript only says "backoff policy" and none of your probes mention that text. |
| Raw transcript search | It does not parse every agent's message roles, tool calls, or schema.                                                           |
| Text roots only       | SQLite-only or binary session stores need a separate export path before FFF can search them.                                    |
| Local machine scope   | It searches the files available to the current machine and user.                                                                |
| No summarization      | Results are candidates and evidence snippets, not synthesized project memory.                                                   |
| FFF dependency        | `fff-mcp` must be installed and runnable for real searches.                                                                     |

## FAQ

### Why not add embeddings?

This project is intentionally a small lexical recall layer. FFF is fast, local, and enough for most "where did we discuss this exact thing?" workflows.

### Why one MCP tool?

Agents do better with one stable contract. `search_sessions` covers search, candidate mode, evidence follow-up, and diagnostics through input fields instead of a wider tool surface.

### Does this copy or re-index my sessions?

No. Raw session files remain the source of truth. FFF maintains its own lightweight search state, but this package does not create a custom session database or markdown export.

### Can I add a private or custom agent?

Yes, if its transcript files are text. Add a named root in `~/.config/agent-session-search/config.json` with an optional `include` filter.

### Why does `pool` use the Application Support directory?

Pool is modeled as one `pool` source rooted at `~/Library/Application Support/poolside` on macOS. That shared root covers Pool CLI trajectories/logs/sessions and Poolside Studio ACP records. The Pool binary path is not the session-history path.

### Why are normal candidates score-free?

Ranking changes order, not the normal response contract. Use `--candidates --debug` or `debug: true` to inspect `debug.ranking.candidates`.

### What should an agent put in `query` versus `queries`?

Use `query` for the concise recall task. Use `queries` for short literal probes the agent already knows are useful. Put cwd, branch, and reason in `operationalContext`.

## Development

```bash
npm install
npm run check:fff   # FFF preflight
npm run check       # typecheck
npm test
npm run build
npm run smoke       # stdio MCP smoke test against a fixture root
npm run dev:mcp     # run the MCP server from source
npm run dev:cli -- "auth token timeout" --json
```

`npm run check:fff` runs the FFF dependency preflight. In an installed package, the same preflight is available as `agent-session-search-doctor`.

### Verifying A Local Package Build

```bash
npm pack --dry-run --json
tmpdir="$(mktemp -d)"
npm pack --pack-destination "$tmpdir"
mkdir "$tmpdir/app"
cd "$tmpdir/app"
npm init -y
npm install --foreground-scripts --no-audit --no-fund "$tmpdir"/agent-session-search-*.tgz
npx agent-session-search-doctor
npx agent-session-search "auth token timeout" --json
npx agent-session-search-mcp
```

### Publishing To npm

Publishing is tag-driven through GitHub Actions and npm trusted publishing. There is no npm token in this repo.

One-time npm setup: on npmjs.com, add a trusted publisher for `@benvenker/agent-session-search` using GitHub Actions, repository `benvenker/agent-session-search`, and workflow `.github/workflows/publish.yml`.

To publish a release:

```bash
npm version patch   # or minor / major
git push origin main --follow-tags
```

The pushed `vX.Y.Z` tag runs CI, checks that the tag matches `package.json`, publishes that version to npm, and creates the GitHub Release marked as latest.

The publish workflow runs the tests that do not require a locally installed `fff-mcp`; run `npm run smoke` locally when changing the stdio MCP path.

## About Contributions

> _About Contributions:_ Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

## License

MIT. See [LICENSE](./LICENSE).
