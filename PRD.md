# Agent Session Search PRD

## Summary

Build a lightweight local MCP server for searching coding-agent session history.

The server should provide one agent-facing search interface while using multiple
real-root FFF indexes behind the scenes. Raw session files remain the source of
truth. FFF provides the fast lexical search layer. A thin wrapper provides query
rewriting, source fanout, path normalization, and agent-friendly output.

This is not a replacement for code search. It is for prior coding-agent memory:
Codex, Claude Code, Pi Agent, Cursor, Hermes, and similar local transcript
corpora.

## Problem

Agents often need to answer questions such as:

- Have we debugged this before?
- Which prior session discussed this error?
- Did a previous agent touch this file, branch, PR, bead, or feature?
- What did Codex, Claude, Pi, Cursor, or Hermes try last time?
- Where is the session that mentioned this stack trace or failing spec?

The old CASS-style approach was too brittle. Heavy indexing, semantic search,
and background state drift made the memory system hard to trust. We need a much
smaller tool that is fast, transparent, and easy to fall back from.

## Verified Constraints

- `fff-mcp` accepts a single optional root path:
  `fff-mcp [OPTIONS] [PATH]`.
- Passing multiple paths to one `fff-mcp` process fails.
- The practical model is therefore one FFF instance per source root.
- A mirror directory could work, but it risks returning mirror paths instead of
  canonical session paths and may introduce sync lag.
- A fanout MCP over real source roots avoids path confusion.

## Goals

- Expose one MCP tool for searching session history across configured sources.
- Use multiple `fff-mcp` instances, each indexing a real canonical source root.
- Preserve canonical absolute paths in results.
- Rewrite natural-language queries into a small set of FFF-friendly literal
  patterns.
- Return compact session candidates by default, with source/root metadata and an
  explicit evidence follow-up path when the agent needs more context.
- Avoid custom indexing, embeddings, SQLite, markdown exports, and durable
  session aggregation in v1.

## Non-Goals

Do not build these in v1:

- Semantic/vector search
- SQLite or custom BM25 indexes
- Markdown export of sessions
- Session-level aggregation/scoring
- Nightly summaries
- Web UI or TUI
- Full parsers for every session format
- Arbitrary code execution

The guiding rule is: do not rebuild CASS.

## Source Roots

Initial configurable roots:

```text
codex  -> /Users/ben/.codex/sessions
claude -> /Users/ben/.claude/projects
pi     -> /Users/ben/.pi/agent/sessions
cursor -> /Users/ben/.cursor/projects
hermes -> /Users/ben/.hermes/sessions
pool   -> /Users/ben/Library/Application Support/poolside
```

Paths must be configurable. Missing roots should be skipped with warnings.
The `pool` default is the shared Pool history root reported by `pool config`,
including CLI trajectories/logs/sessions and Poolside Studio ACP records.

Cursor session transcripts are stored under project-specific directories, for
example:

```text
/Users/ben/.cursor/projects/Users-ben-code-poolside-paperclip-claude-worktrees-lucid-leavitt/agent-transcripts/7f0355c8-2b3d-49f4-8be5-166e230cc102
```

## Architecture

```text
Agent query
  -> agent-session-search MCP
    -> query rewrite
    -> fanout to child FFF instances
      -> fff-mcp /Users/ben/.codex/sessions
      -> fff-mcp /Users/ben/.claude/projects
      -> fff-mcp /Users/ben/.pi/agent/sessions
      -> fff-mcp /Users/ben/.cursor/projects
      -> fff-mcp /Users/ben/.hermes/sessions
      -> fff-mcp /Users/ben/Library/Application Support/poolside
    -> normalize results to canonical absolute paths
    -> return compact candidates or evidence hits grouped by source/path
```

The wrapper should treat FFF as the search engine. It should not parse sessions
or maintain a separate index.

## MCP Tool: `search_sessions`

Proposed input:

```ts
type BuiltinSource = "codex" | "claude" | "pi" | "cursor" | "hermes" | "pool";
type SourceName = BuiltinSource | (string & {});

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

Proposed output:

```ts
type SearchSessionsOutput = {
  query: string;
  resultsDisplayMode: "candidates" | "evidence" | "debug";
  expandedPatterns: string[];
  searchedSources: Array<{
    name: SourceName;
    root: string;
    status: "ok" | "missing" | "failed";
    warning?: string;
  }>;
  warnings: Array<{
    source?: SourceName;
    root?: string;
    code: string;
    message: string;
  }>;
  results: Array<SearchCandidate | SearchEvidenceHit>;
  debug?: unknown;
};

type SearchCandidate = {
  source: SourceName;
  root: string;
  path: string;
  sessionId?: string;
  line?: number;
  preview: string;
  hitCount: number;
  matchedQueries: string[];
  matchedPatterns: string[];
  more: {
    evidence: {
      query: string;
      queries?: string[];
      sources: SourceName[];
      resultsDisplayMode: "evidence";
      paths: string[];
    };
  };
};

type SearchEvidenceHit = {
  source: SourceName;
  root: string;
  path: string;
  line?: number;
  content: string;
  query?: string;
  pattern?: string;
  context?: string[];
};
```

The default output should be compact session candidates, not a dump of every
matching line. Candidates preserve source/root/path attribution and include a
`more.evidence` follow-up request so the calling agent can ask for background
context only when it needs it. Evidence and debug modes stay close to FFF's raw
hit shape.

## Interface Design Decision

V1 should expose one MCP tool:

```ts
search_sessions(input: SearchSessionsInput): Promise<SearchSessionsOutput>
```

The common fallback call should be boring:

```json
{ "query": "where did we debug global search embedding timeout?" }
```

The agent-native call should preserve the user's recall intent while letting the
calling LLM agent provide planned literal probes and lightweight operational
context. `query` should be a concise recall task, not a verbatim dump of the
full prompt. Agents should strip tool-use directions, output-format requests,
and examples from `query` so those instructions do not become future searchable
noise:

```json
{
  "query": "Find the prior session about PR 227 and the papercuts branch.",
  "queries": ["PR #227", "paper-cuts", "poolside-studio pull 227"],
  "operationalContext": {
    "cwd": "/Users/ben/code/poolside/poolside-studio",
    "branch": "paper-cuts",
    "reason": "Recover the prior session that worked on this PR."
  }
}
```

Optional fields exist only for agent-planned probes, operational context,
source filtering, result depth, selected follow-up paths, result caps, context
size, and diagnostics. Do not expose pipeline steps such as `resolveRoots`,
`rewriteQuery`, `searchRoot`, or `readExcerpt` as MCP tools in V1. Those are
useful internal seams and possible future code-mode operations, but exposing
them now would make agents assemble a brittle workflow manually.

The implementation should be organized as deep, testable modules behind the
single tool:

- A config/root resolver that loads configured source roots, applies source
  filters, expands default roots, and reports missing or unreadable roots as
  warnings.
- A deterministic query rewriter that turns natural-language prompts into a
  small list of literal FFF-friendly patterns.
- An FFF backend that owns one child `fff-mcp` process for one root and converts
  backend-specific results into raw normalized hits.
- A fanout coordinator that runs searches across roots and patterns, isolates
  per-source failures, enforces caps, and combines warnings.
- A path normalizer that converts returned paths into canonical absolute paths
  while preserving source/root attribution.
- A response shaper that returns expanded patterns, searched source status,
  warnings, compact candidates by default, and raw-ish evidence hits on
  request.

The internal module boundaries are for implementation quality and tests, not
for the public MCP API.

## Query Rewriting

The primary caller is an LLM-powered agent. The tool should therefore accept
agent-planned probes through `queries` and treat deterministic rewriting as a
fallback and mechanical expander, not as a full natural-language understanding
layer.

When an agent has enough context, it should infer the operational recall task
from the user request and environment, then provide short literal probes in
`queries`. The tool preserves `query` as the concise recall task for audit/debug,
searches the planned probes, and records the probe that produced each hit.

The deterministic rules-based rewriter should emit literal search patterns, not
abstract semantic queries.

Prefer:

- Exact phrases from the query
- File paths
- Branch names
- PR/issue/bead IDs
- Commands
- Test names
- Error strings
- Stack trace fragments
- Symbols and package names
- Product/domain synonyms from a small config map
- snake_case, camelCase, kebab-case variants where obvious

Avoid:

- Broad generic terms such as "bug", "code", "problem", "thing"
- More than 3-8 patterns by default
- Unrelated invented concepts
- Model calls by default

If rewriting fails, search the original query as the only pattern.

## Config

Config should live under:

```text
~/.config/agent-session-search/config.json
```

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
    },
    {
      "name": "pool",
      "path": "/Users/ben/Library/Application Support/poolside",
      "include": [
        "trajectories/*.ndjson",
        "logs/*.log",
        "sessions/*.json",
        "acp/**/*.json"
      ]
    }
  ],
  "synonyms": {
    "semantic search": [
      "semantic search",
      "vector search",
      "embeddings",
      "RAG",
      "retrieval"
    ],
    "timeout": ["timeout", "deadline", "hang", "slow", "latency"],
    "auth": [
      "auth",
      "authentication",
      "authorization",
      "login",
      "token",
      "session"
    ]
  },
  "defaults": {
    "maxPatterns": 8,
    "maxResultsPerSource": 50,
    "context": 2
  }
}
```

## FFF Integration

The first implementation should run one child `fff-mcp` process per configured
root and communicate over MCP stdio.

Each child process owns one root. The wrapper maps child results back to:

- `source`
- canonical `root`
- canonical absolute `path`

If a child FFF process fails, the wrapper should return a warning for that source
and still return results from other sources.

## Code Mode Direction

Research from Anthropic and Cloudflare suggests a useful future pattern:
instead of exposing many tiny MCP tools, expose a small typed API that agents can
compose from code in a sandbox.

For this project, do not start with Code Mode. Build the direct
`search_sessions` tool first.

Design internals so a later read-only code-mode tool is easy:

```ts
await sessions.roots();
await sessions.expandQuery("global search embedding timeout");
await sessions.multiGrep({
  sources: ["codex", "claude", "cursor"],
  patterns: ["global search", "embedding timeout", "Elasticsearch"],
  context: 2,
  maxResults: 50,
});
await sessions.readExcerpt({ path, line, before: 5, after: 10 });
```

Future code mode constraints:

- Read-only
- Whitelisted session roots only
- No arbitrary shell
- No network
- No writes
- Strict timeout and output caps

References:

- Anthropic: https://www.anthropic.com/engineering/code-execution-with-mcp
- Cloudflare Code Mode MCP: https://blog.cloudflare.com/code-mode-mcp/
- Cloudflare Code Mode: https://blog.cloudflare.com/code-mode/
- Cloudflare Agents Codemode docs:
  https://developers.cloudflare.com/agents/api-reference/codemode/

## CLI

An optional CLI can share the same library:

```bash
agent-session-search "where did we debug global search embedding timeout?"
agent-session-search "auth token timeout" --source codex --json --debug
agent-session-search "auth token timeout" --json --evidence --path /Users/ben/.codex/sessions/session.jsonl
```

The CLI is useful for humans and fallback workflows, but MCP is the primary
product surface. CLI flags should map to the same result modes so fallback
agents do not have to invent a separate workflow.

## Future Roadmap

### Project-Aware Result Ordering

Search should continue to fan out broadly across all configured session roots.
FFF is fast enough that the tool should not need to restrict search scope just
to improve perceived relevance.

A future version can improve result ordering by boosting hits associated with
the caller's current project. The intended behavior is:

- If the caller provides a current working directory, hits from sessions tied to
  that directory should appear earlier.
- If the current directory is inside a worktree, hits tied to the parent project
  or sibling worktrees should also receive a relevance boost.
- Results from other projects should still be returned, just ranked lower.
- The response should preserve raw source/root/path metadata so agents can see
  why a result was returned.

This should be a soft ordering signal, not a hard filter. Useful matches often
come from adjacent projects, prior worktrees, or sessions whose metadata is
incomplete.

The likely implementation is a project identity resolver that can infer a
stable project key from one or more signals:

- Git repository root and worktree common directory.
- Current working directory and parent repository paths.
- Session file paths that encode project paths, such as Claude and Cursor
  project directories.
- Transcript metadata, if an agent records cwd, repo root, branch, or worktree
  path inside the session.

This is out of scope for V1 because agent transcript formats differ, worktree
relationships need careful handling, and ranking introduces product choices that
should not block the first reliable lexical search tool.

### Beads Workflow Encoding

This repo should eventually encode its issue-tracking workflow so planning
skills consistently use beads instead of GitHub issues.

The intended mapping is:

- Use `br`/`bv` as the issue tracker.
- Treat Matt Pocock skill instructions to "file an issue" as "create or update a
  bead" unless GitHub is explicitly requested.
- Use bead-native state, dependencies, deferral, priority, type, assignee, and
  `br ready` instead of duplicating those concepts as labels.
- Use labels only for triage meanings that beads does not model directly:
  `needs-triage`, `needs-info`, and `ready-for-human`.
- Treat "ready-for-agent" as a bead that appears in `br ready` and has clear
  acceptance criteria and test expectations, not as a required label.
- Represent `wontfix` by closing the bead with reason `wontfix`.

This should be encoded later in `AGENTS.md`, a repo-local skill, or a small
workflow script. It is out of scope for V1 because the search MCP itself is more
urgent.

## Reliability

- Missing roots are warnings, not fatal errors.
- Query rewrite failure falls back to the original query.
- Per-source FFF failures are warnings if at least one source succeeds.
- If all FFF sources fail, return a clear error and an `rg` fallback command.
- Use FFF for normal recall.
- Use `rg` only for exhaustive proof-style search.

## Testing Decisions

Tests should focus on external behavior at module boundaries rather than child
process implementation details.

Test the query rewriter with representative natural-language prompts, exact
phrases, file paths, branch names, error strings, and broad terms that should be
discarded.

Test root resolution with configured roots, default roots, missing roots,
unreadable roots, source filtering, custom source names, and include patterns
such as Cursor's `*/agent-transcripts/*`.

Test the FFF backend behind a fake child process or fake MCP client. The tests
should assert request shape, result normalization, warning conversion, timeout
handling, and cleanup behavior without depending on a live FFF index.

Test fanout with multiple roots and patterns, partial source failures, all-source
failure, caps per source, and warning aggregation.

Test path normalization with relative paths, absolute paths, symlinks where
practical, and paths returned from nested session directories.

Test the MCP tool contract with the common `{ "query": "..." }` call and with a
fully specified request. Assertions should cover `expandedPatterns`,
`searchedSources`, `warnings`, compact candidate shape, and raw-ish evidence hit
shape.

## Acceptance Criteria

V1 is acceptable when:

1. A local MCP server exposes `search_sessions`.
2. It searches raw session files directly through FFF.
3. It supports multiple configured real source roots.
4. It preserves canonical absolute paths in returned results.
5. It rewrites a natural query into multiple lexical patterns.
6. It supports source filtering.
7. It supports JSON-structured output.
8. It handles missing roots gracefully.
9. It does not expose lower-level pipeline operations as MCP tools in V1.
10. It can search Codex sessions under `/Users/ben/.codex/sessions`.
11. It can search Claude sessions under `/Users/ben/.claude/projects`.
12. It can search Pi sessions under `/Users/ben/.pi/agent/sessions`.
13. It can search Cursor transcripts under `/Users/ben/.cursor/projects`.
14. It can search Hermes sessions under `/Users/ben/.hermes/sessions`.
15. It can search Pool sessions under `/Users/ben/Library/Application Support/poolside`.
16. It has focused tests for query rewriting, root resolution, FFF backend
    normalization, fanout failure handling, path normalization, and MCP response
    shape.
17. It does not implement custom indexing, embeddings, markdown export, or
    durable session aggregation beyond per-response candidate grouping.

## Open Questions

- What is the cleanest MCP client implementation for talking to child FFF stdio
  servers?
- Does FFF's MCP output include enough path and line metadata for direct file
  reads across all query modes?
- Is context useful for JSONL session files, or are single-line matches enough?
- Should the first version expose a `read_excerpt` helper, or should agents use
  filesystem tools directly after `search_sessions` returns a path?
- How should the wrapper cap large JSONL result lines without hiding the match?
- Which Claude and Pi session paths are actually present on this machine?
- Do Cursor transcripts always live under `*/agent-transcripts/*` without file
  extensions?
- What file extension and line shape do Hermes sessions use?
