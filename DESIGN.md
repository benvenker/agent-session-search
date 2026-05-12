# Agent Session Search Design

This file replaces the completed PRD. It keeps the design decisions that still matter for implementation and review.

## Product Contract

Agent Session Search is a local TypeScript ESM package that exposes:

- one MCP server binary: `agent-session-search-mcp`
- one public MCP tool: `search_sessions`
- one CLI binary: `agent-session-search`
- one setup/diagnostic binary: `agent-session-search-doctor`

The product searches local coding-agent session history across configured source roots. Raw session files remain the source of truth. FFF provides lexical search through `fff-mcp`. This package handles source-root resolution, deterministic query rewriting, fanout, path normalization, response shaping, and agent-friendly discovery surfaces.

The public MCP surface stays centered on `search_sessions`. Do not add lower-level MCP tools for root resolution, query rewriting, FFF child calls, or excerpt reads unless the one-tool boundary changes.

## Non-Goals

Do not add these to the mainline product without a new design pass:

- semantic or vector search
- custom indexes, SQLite stores, or durable derived session databases
- markdown exports of session history
- nightly summaries or long-lived aggregation
- a web UI or TUI
- full parsers for every agent transcript format
- arbitrary code execution

Use FFF for normal lexical recall. Keep the wrapper small.

## Source Roots

Built-in source roots are defined in `src/roots.ts` and are merged with the optional user config at `~/.config/agent-session-search/config.json`.

Current built-ins:

```text
codex  -> ~/.codex/sessions
claude -> ~/.claude/projects
pi     -> ~/.pi/agent/sessions
cursor -> ~/.cursor/projects
hermes -> ~/.hermes/sessions
pool   -> ~/Library/Application Support/poolside
```

The `pool` root points at the shared Pool history directory, not the Pool binary install path. That root covers Pool CLI trajectories/logs/sessions and Poolside Studio ACP records. Use `pool config` to verify custom Pool log or trajectory paths before changing the default.

Configured roots can replace built-ins by name, add custom source names, or set `"enabled": false` to disable a source without deleting it. Missing or unreadable roots are warnings, not fatal errors.

## Search Flow

```text
agent or CLI query
  -> search_sessions / CLI search input
    -> load config and resolve enabled source roots
    -> expand planned probes or deterministic literal patterns
    -> fan out to one fff-mcp child per source root
    -> normalize hits to canonical absolute paths
    -> shape results as candidates, evidence groups, or evidence hits
```

Each FFF child indexes one real source root. Do not use a mirror directory; it can return mirror paths instead of canonical session paths and can introduce sync lag.

If one source fails, the response includes source-level warnings and continues with other searchable roots. If all attempted sources fail, the response includes an `all_sources_failed` warning with an `rg` fallback command for exhaustive proof-style search.

## MCP Tool

`search_sessions` accepts the shape defined in `src/tool.ts` and `src/types.ts`:

```ts
type SearchSessionsInput = {
  query: string;
  queries?: string[];
  operationalContext?: unknown;
  sources?: SourceName[] | "all";
  resultsDisplayMode?: "candidates" | "evidence" | "debug";
  paths?: string[];
  maxPatterns?: number;
  maxResultsPerSource?: number;
  context?: number;
  debug?: boolean;
};
```

Set `query` to a concise recall task. Put short literal probes planned by the calling agent in `queries`. Put cwd, branch, repo, and the reason for recall in `operationalContext`; that context explains the search without becoming search text.

The default mode is `candidates`. A candidate includes `source`, `root`, canonical `path`, `preview`, match metadata, and a server-prepared `more.evidence` payload that can be echoed back to the same tool.

`evidence` mode has two shapes:

- unscoped evidence returns session-level evidence groups with representative snippets
- path-restricted evidence returns raw-ish evidence hits for selected canonical paths

`debug` mode includes query expansion and backend diagnostics. The `context` field is reserved for backend support; current FFF results remain bounded snippets rather than surrounding-line reads.

## CLI And Discovery Surfaces

The CLI is the shipped fallback and inspection surface. It shares the same library and result shape as the MCP server.

Agent-facing CLI surfaces:

```bash
agent-session-search help
agent-session-search --version
agent-session-search capabilities --json
agent-session-search sources --json
agent-session-search robot-docs guide
agent-session-search --robot-triage
agent-session-search "auth token timeout" --json
agent-session-search-doctor
agent-session-search-doctor --list-orphans
```

`capabilities --json` is the machine-readable contract for commands, modes, environment variables, exit codes, and the single MCP tool. `sources --json` is CLI-only source/config inspection; do not turn it into a second MCP tool.

`agent-session-search-doctor` is the setup and FFF health-check surface. It verifies that `fff-mcp` is on `PATH`, can run a live smoke test, and can list or reap orphaned `fff-mcp` processes from crashed sessions.

`search_sessions` returns JSON as MCP text content and does not advertise `outputSchema`. The MCP SDK supports structured content, but the installed FastMCP wrapper path used here still returns successful tool results as string/content-style values. Keep the text-JSON behavior pinned by tests until a FastMCP upgrade makes structured output straightforward.

## Development And Validation

Primary project commands are defined in `package.json`:

```bash
npm install
npm run check:fff
npm run check:beads
npm run check
npm test
npm run build
npm run smoke
```

The pre-commit hook runs `npx lint-staged`, `npm run check:beads`, `npm run check`, and `npm test`. Agents working in constrained shells may need `npx`, `npm`, and `fff-mcp` on `PATH`; on this machine `/opt/homebrew/bin` and `/Users/ben/.local/bin` are the important additions.

## Deferred Ideas

Track concrete follow-up work in Beads. Keep this section short; treat it as design memory, not a backlog.

- Project-aware result ordering: boost hits tied to the caller's current cwd, repo, branch, or related worktrees without filtering out other sources.
- Structured MCP output: revisit `outputSchema` and `structuredContent` if FastMCP supports successful structured tool results cleanly.
- Read-only Code Mode: consider a small typed API only if composing lower-level operations from sandboxed code becomes clearly more useful than the current one-tool MCP surface.
- Richer evidence excerpts: revisit surrounding-line or byte-window reads only if candidate/evidence modes stop being enough. Keep any expansion inside `search_sessions` unless the one-tool boundary changes.
