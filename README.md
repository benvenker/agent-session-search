# Agent Session Search

Local MCP server (and CLI) that lets coding agents search their own past sessions across Codex, Claude Code, Cursor, Pi, Hermes, and anything else you point it at. One tool, one query, real session paths.

## Why

Agents forget. Five minutes after a session ends, the only place that thread of context still exists is the JSONL transcript on disk. So they keep asking the same questions:

- Have we debugged this before?
- Which prior session discussed this error?
- Did a previous agent touch this file, branch, PR, or feature?
- What did Codex, Claude, Cursor, Pi, or Hermes try last time?
- Where is the session that mentioned this stack trace or failing spec?

Those transcripts are already on your machine. They just need to be searchable.

## Why this exists

Agent transcripts are JSONL files in well-known directories. [FFF][fff] is a fast lexical search engine that takes a single directory as its input. The smallest useful thing is one MCP tool that fans `fff-mcp` out across the per-tool session roots and returns canonical absolute paths.

That's the whole tool. One binary (`fff-mcp`) plus one npm package. No background indexer, no embeddings, no separate database to babysit. Heavier session-memory systems can do more. They also cost more to keep running than they pay back, at least for me. This is the smallest thing that worked.

[fff]: https://dmtrkovalenko.dev/blog/just-build-fast-tools

## Quickstart

```bash
# 1. Install the FFF backend (one-time)
curl -L https://dmtrkovalenko.dev/install-fff-mcp.sh | bash

# 2. Install this package
npm install -g @benvenker/agent-session-search

# 3. Verify FFF is wired up
agent-session-search-doctor

# 4. Try it from the CLI against your real session roots
agent-session-search "auth token timeout" --json
```

Review the FFF installer before piping it to bash: <https://dmtrkovalenko.dev/install-fff-mcp.sh>.

The package ships default source roots for `codex`, `claude`, `pi`, `cursor`, and `hermes`. Drop a config file (see [Configuration](#configuration)) to override paths or add your own sources.

Or skip the manual setup entirely: once the package is installed, point a coding agent at this README and ask it to configure things for you. The config file and the MCP client registration are both plain JSON, the schema below is small, and the agent already knows which session directories live under your home dir. A prompt like "Set up agent-session-search on this machine: detect which default session roots actually exist, write `~/.config/agent-session-search/config.json` with only the ones that do, and add the MCP server entry to my client config" is usually enough.

## What an agent call looks like

The simple call is boring on purpose:

```json
{ "query": "where did we debug global search embedding timeout?" }
```

The agent-native call is where this tool earns its keep. `query` stays a concise recall task (so it reads cleanly in audit logs), `queries` carries short literal probes the calling LLM has already planned, and `operationalContext` carries the cwd / branch / reason the agent already knows from its environment:

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

Strip tool-use directions, output-format instructions, and examples out of `query`. They become noise in future searches. If `queries` is omitted, the tool falls back to deterministic literal-pattern rewriting of `query`.

### Candidates first, evidence on demand

By default `search_sessions` returns compact session-level **candidates** grouped by `source` and `path`: a short `preview`, `hitCount`, the matched patterns, and a complete `more.evidence` follow-up request. The agent can then call the same tool again with that `more.evidence` object as input to get matching snippets from one selected session. No second pipeline, no new flags. Path-restricted evidence requests bypass the per-source cap so a selected session is never lost behind unrelated hits.

This keeps the default response small enough to skim and lets the agent pull detail only where it actually needs it.

## How it works

```text
agent query
  -> agent-session-search MCP
    -> deterministic query rewrite (or agent-planned `queries`)
    -> fanout to one fff-mcp child per source root
        codex   -> ~/.codex/sessions
        claude  -> ~/.claude/projects
        pi      -> ~/.pi/agent/sessions
        cursor  -> ~/.cursor/projects
        hermes  -> ~/.hermes/sessions
    -> normalize results to canonical absolute paths
    -> return compact candidates (or evidence hits) grouped by source/path
```

Design choices worth knowing:

- **One MCP tool, not many.** Internal seams (root resolution, query rewriting, FFF backend, fanout, path normalization) stay testable modules but never leak into the agent-facing API.
- **FFF is the engine.** No custom index, no embeddings, no SQLite. Raw session files are the source of truth.
- **Canonical absolute paths in results**, with `source` and `root` attribution preserved, so agents can read the file directly.
- **Partial success over hard failure.** A missing or unreadable root emits a warning; search continues across the rest.

### What this doesn't do

No semantic recall. Ask for "the session where we discussed retry logic" without using the word "retry," and this won't find it. No schema-aware filtering of message roles or tool calls; it greps raw JSONL lines, not parsed conversations. No cross-agent normalization, so a Codex tool call and a Claude Code tool call look different to it. If you need any of those, you want a different tool.

### Why MCP (and what about the CLI?)

`fff-mcp` is FFF's MCP server. This package spawns one `fff-mcp` child per source root and re-exposes a single `search_sessions` tool over MCP to agents.

The CLI is not a different code path. `agent-session-search "..."` runs the same fanout, talks to the same `fff-mcp` children, and returns the same result shape. It just skips the agent layer on top, so you can use it directly from a shell or as a fallback when an agent's MCP client isn't available.

## Configuration

By default, the server reads:

```text
~/.config/agent-session-search/config.json
```

Override with `AGENT_SESSION_SEARCH_CONFIG`.

Example:

```json
{
  "roots": [
    {
      "name": "codex",
      "path": "/Users/ben/.codex/sessions",
      "include": ["*.jsonl"]
    },
    {
      "name": "claude",
      "path": "/Users/ben/.claude/projects",
      "include": ["*.jsonl"]
    },
    {
      "name": "pi",
      "path": "/Users/ben/.pi/agent/sessions",
      "include": ["*"]
    },
    {
      "name": "cursor",
      "path": "/Users/ben/.cursor/projects",
      "include": ["*/agent-transcripts/*"]
    },
    {
      "name": "hermes",
      "path": "/Users/ben/.hermes/sessions",
      "include": ["*"]
    }
  ],
  "synonyms": {
    "auth": ["authentication", "login"],
    "timeout": ["timed out", "deadline"]
  },
  "defaults": {
    "maxPatterns": 8,
    "maxResultsPerSource": 50,
    "context": 0
  }
}
```

Built-in defaults already cover the five source names above. A configured root with the same name replaces the built-in default. Set `"enabled": false` to disable a root without deleting it. `include` patterns are enforced against returned paths: slashless patterns like `*.jsonl` match basenames anywhere under the root; patterns containing `/` match root-relative paths. `defaults` are optional, request fields override them, invalid values are ignored.

### Adding another agent

The five built-in source names are defaults, not a closed list. If an agent writes its transcripts to a directory in a text format (JSONL, plain text, Markdown), you can add it in config with no parser, converter, or code change:

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

- `name` is any stable label you'll filter on with `--source` or the `sources` field. It does not have to match a built-in.
- `path` is the directory `fff-mcp` should index.
- `include` is optional but useful for skipping noise (cache files, lockfiles, and so on).
- Results come back with canonical absolute paths and `source`/`root` attribution, the same shape as the built-ins.

You don't need to re-declare the five built-ins to add a new one. They stay enabled unless you override them by name or set `"enabled": false`. This won't work for agents that store sessions as sqlite databases or binary blobs; `fff-mcp` is a text grep, not a format parser.

## Register with an MCP client

Once installed globally, the server runs as `agent-session-search-mcp` over stdio. Add it to your MCP client config:

```json
{
  "mcpServers": {
    "agent-session-search": {
      "command": "agent-session-search-mcp"
    }
  }
}
```

If your client doesn't put the npm global bin on `PATH`, point `command` at the absolute path printed by `which agent-session-search-mcp`.

The server exposes one tool, `search_sessions`. Minimal input:

```json
{
  "query": "auth token timeout",
  "sources": "all",
  "resultsDisplayMode": "candidates",
  "maxResultsPerSource": 20
}
```

Omit `sources` (or pass `sources: "all"`) to search every enabled root. To restrict, pass an array such as `["codex", "claude"]`. The input schema accepts `context` for forward compatibility; the FFF backend currently returns bounded matching lines, not surrounding context lines.

## CLI

The CLI shares the same library and result shape, so a fallback agent doesn't have to learn a second workflow:

```bash
agent-session-search "auth token timeout" --json
agent-session-search "auth token timeout" --source codex --source claude --json
agent-session-search "auth token timeout" --json --evidence --path /Users/ben/.codex/sessions/session.jsonl
```

JSON output includes:

- `query`: the original query.
- `resultsDisplayMode`: `candidates`, `evidence`, or `debug`.
- `expandedPatterns`: deterministic FFF-friendly literal patterns searched.
- `searchedSources`: source names, canonical roots, status, source-level warnings.
- `warnings`: missing roots, unreadable roots, backend failures, partial-success notices.
- `results`: compact candidates by default, or FFF-backed evidence hits with `source`, `root`, canonical absolute `path`, `line`, bounded `content`, and optional `query` / `pattern`.

## Warnings and partial success

Missing and unreadable roots do not fail the whole search. A missing root emits a `missing_root` warning; an unreadable root emits an `unreadable_root` warning. As long as one source is searchable, you get partial results.

Unknown or disabled requested sources emit `unknown_source`; if no enabled roots match a source filter, the response also includes `no_sources_selected`.

If every attempted source fails and there are no results, the response includes an `all_sources_failed` warning with a concrete `rg` fallback command. Use that for exhaustive proof-style search.

## Environment variables

All optional, and respected by both the CLI and the MCP server. The defaults work for most setups. Reach for these only when you need to override the config location, point FFF at a non-default database directory, or tune timeouts. When you do set them, the natural place is the `env` block of the MCP server entry in your client config (or an export in your shell rc for the CLI).

- `AGENT_SESSION_SEARCH_CONFIG`: path to the JSON source-root config file.
- `AGENT_SESSION_SEARCH_FFF_DB_DIR`: directory containing FFF's `frecency.mdb` and `history.mdb`. Set this only when FFF should use a non-default database directory.
- `AGENT_SESSION_SEARCH_FFF_TIMEOUT_MS`: per-pattern FFF timeout in milliseconds. Runtime searches default to 15000.
- `AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_ATTEMPTS`: retry count for empty FFF results.
- `AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_DELAY_MS`: delay between empty-result retries in milliseconds.

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

`npm run check:fff` runs the FFF dependency preflight. If `fff-mcp` is on `PATH`, it prints the resolved path, version, a live grep smoke result, and the `PATH` used for the check, with isolated FFF database files matching the runtime path. In an installed package, run the same preflight as `agent-session-search-doctor`.

### Verifying a local package build

Before handing off a local build, inspect the tarball and exercise the bin shims from a clean temp app:

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

### Publishing to npm

Publishing is tag-driven through GitHub Actions and npm trusted publishing. There is no npm token in this repo.

One-time npm setup: on npmjs.com, add a trusted publisher for `@benvenker/agent-session-search` using GitHub Actions, repository `benvenker/agent-session-search`, and workflow `.github/workflows/publish.yml`.

To publish a release:

```bash
npm version patch   # or minor / major
git push origin main --follow-tags
```

The pushed `vX.Y.Z` tag runs CI, checks that the tag matches `package.json`, and publishes that version to npm.

## Notes

- This package is published to npm as `@benvenker/agent-session-search`.
- License: MIT (see `LICENSE`).
