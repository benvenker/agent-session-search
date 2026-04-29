# Agent Session Search

Local MCP server and CLI for searching coding-agent session history through FFF.
The public MCP surface is intentionally small: one `search_sessions` tool backed
by configured session roots.

## Prerequisites

- Node.js 20 or newer.
- npm.
- The external `fff-mcp` binary on `PATH`.

`npm install` installs this package's Node dependencies. It does not install
`fff-mcp`.

## Install And Verify

For local development:

```bash
npm install
npm run check:fff
npm run check
npm test
npm run build
npm run smoke
```

Before handing off a local package build, inspect the tarball contents and test
the installed bin shims from a clean temporary app:

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

`npm run check:fff` runs the FFF dependency preflight. If `fff-mcp` is available,
it prints the resolved path, version, live grep smoke result, and `PATH` used
for the check. The smoke check searches a temporary file with isolated FFF
database files, matching the runtime path used by `agent-session-search`. In an
installed package, run the same preflight with:

```bash
agent-session-search-doctor
```

If `fff-mcp` is missing, install it with the official FFF MCP installer:

```bash
curl -L https://dmtrkovalenko.dev/install-fff-mcp.sh | bash
```

Review the installer before running it:

```text
https://dmtrkovalenko.dev/install-fff-mcp.sh
```

Set `AGENT_SESSION_SEARCH_FFF_DB_DIR` only when FFF should use a non-default
database directory. That directory should contain the FFF `frecency.mdb` and
`history.mdb` files.

## Configuration

By default, the server looks for configuration at:

```text
~/.config/agent-session-search/config.json
```

Override that path with `AGENT_SESSION_SEARCH_CONFIG`.

Example configuration:

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
  }
}
```

The built-in defaults cover the same five source names: `codex`, `claude`, `pi`,
`cursor`, and `hermes`. A configured root with the same name replaces the
built-in default. Set `"enabled": false` on a root to disable it.

## MCP Server

Run the development MCP server over stdio:

```bash
npm run dev:mcp
```

After building, run the server entrypoint directly:

```bash
node dist/server.js
```

When this package is installed, register the package bin command with your MCP
client:

```bash
agent-session-search-mcp
```

The server exposes one tool:

```text
search_sessions
```

Example tool input:

```json
{
  "query": "auth token timeout",
  "sources": "all",
  "resultsDisplayMode": "candidates",
  "maxResultsPerSource": 20,
  "context": 2
}
```

For conversational recall requests, agents should set `query` to a concise
recall task, not the full prompt. Strip tool-use directions, output-format
requests, and examples from `query`; put useful environment details in
`operationalContext` and short planned probes in `queries`:

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

If `queries` is omitted, the tool falls back to deterministic rewriting of
`query`.

The default `resultsDisplayMode` is `"candidates"`. It returns compact
session-level leads grouped by `source` and `path`, with a short `preview`,
`hitCount`, matched patterns, and a complete `more.evidence` follow-up request.
If the agent needs matching snippets from a selected session, it can call the
same tool again with the candidate's `more.evidence` object as input.

Omit `sources` or pass `sources: "all"` to search every enabled source. To search
only specific sources, pass an array such as `"sources": ["codex", "claude"]`.

## CLI Usage

Run the automated smoke path through the real stdio MCP entrypoint with a
deterministic fixture root:

```bash
npm run smoke
```

For manual local checks against configured session roots:

```bash
npm run dev:cli -- "auth token timeout" --json
```

After installation, use the packaged CLI:

```bash
agent-session-search "auth token timeout" --json
agent-session-search "auth token timeout" --source codex --source claude --json
agent-session-search "auth token timeout" --json --evidence --path /Users/ben/.codex/sessions/session.jsonl
```

The JSON output includes:

- `query`: the original query.
- `resultsDisplayMode`: `candidates`, `evidence`, or `debug`.
- `expandedPatterns`: deterministic FFF-friendly literal patterns searched.
- `searchedSources`: source names, canonical roots, status, and any source-level
  warning.
- `warnings`: missing roots, unreadable roots, backend failures, and
  partial-success notices.
- `results`: compact candidates by default, or FFF-backed evidence hits with
  `source`, `root`, canonical absolute `path`, `line`, `content`, optional
  `pattern`, and optional `context` when `resultsDisplayMode` is `"evidence"` or
  `"debug"`.

## Warnings And Partial Success

Missing and unreadable roots do not fail the whole search. A missing root emits a
`missing_root` warning; an unreadable root emits an `unreadable_root` warning.
Search continues across the remaining readable roots and may return partial
results.
When at least one source can be searched, partial results are expected instead of
failing the whole request.

If every attempted source fails and there are no results, the response includes
an `all_sources_failed` warning.

## Environment Variables

- `AGENT_SESSION_SEARCH_CONFIG`: path to the JSON source-root configuration file.
- `AGENT_SESSION_SEARCH_FFF_DB_DIR`: directory containing `frecency.mdb` and
  `history.mdb` for FFF MCP.
- `AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_ATTEMPTS`: retry count for empty FFF
  results.
- `AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_DELAY_MS`: delay between empty-result
  retries in milliseconds.

## CASS

CASS is not part of this tool. Do not run cass, `cass search`, `cass context`,
`cass timeline`, `cass index`, or any CASS watcher to use Agent Session Search.
