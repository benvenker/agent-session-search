# MCP Tool Contract

The server exposes one MCP tool: `search_sessions`.

The implementation returns JSON as MCP text content. It does not currently advertise an `outputSchema`; this behavior is pinned by tests while the FastMCP wrapper path returns successful tool results as string/content-style values.

## Input

Required minimal input:

```json
{
  "query": "auth token timeout"
}
```

Common input:

```json
{
  "query": "Find the prior session about PR 227 and the paper-cuts branch.",
  "queries": ["PR #227", "paper-cuts", "poolside-studio pull 227"],
  "operationalContext": {
    "cwd": "/Users/ben/code/poolside/poolside-studio",
    "branch": "paper-cuts",
    "reason": "Recover the prior session that worked on this PR."
  },
  "sources": "all",
  "resultsDisplayMode": "candidates"
}
```

Fields:

| Field                 | Use                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `query`               | Required recall task. Keep it concise and human-readable.                                                        |
| `queries`             | Optional planned probes. Use short literal phrases the caller already knows.                                     |
| `operationalContext`  | Optional caller-known context such as cwd, repo, branch, recent chat, or reason.                                 |
| `sources`             | Optional array such as `["codex", "claude"]`, or `"all"` for every enabled source. Omit to search enabled roots. |
| `resultsDisplayMode`  | `candidates`, `evidence`, or `debug`. Defaults to `candidates`, unless `debug: true` is supplied alone.          |
| `paths`               | Restrict evidence results to canonical session paths.                                                            |
| `maxPatterns`         | Limit expanded literal patterns.                                                                                 |
| `maxResultsPerSource` | Limit results per source. Explicit caps still apply to focused path evidence.                                    |
| `context`             | Reserved for backend support. Current FFF results remain bounded matching lines.                                 |
| `debug`               | Include query expansion and diagnostics. Candidate ranking diagnostics require candidate mode plus debug.        |

## Result Modes

### Candidates

Default mode. `resultsShape` is `candidate_groups`. Results are ordered static match groups; each group contains compact session-level candidate leads grouped by `source` and canonical `path`.

Top-level `metadata` includes `contractVersion`, backend mode, limits, and count semantics. Backend mode is one of `multi_grep`, `sequential_grep`, `sequential_grep_fallback`, or `custom`; fallback responses include `metadata.backend.fallbackReason`.

Candidate groups include `id`, `priority`, `label`, `guidance`, `patternIds`, `assignedCandidateCount`, `hitCount`, `shownLeadCount`, `hasMore`, and `leads`. Counts use `{ "value": number, "relation": "eq" | "gte" }` so callers can tell exact counts from lower bounds. Empty groups are omitted.

Each candidate includes:

- `source`
- `root`
- `path`
- optional `sessionId`
- `preview`
- `hitCount`
- `matchedQueries`
- `matchedPatterns`
- `strongestGroup`
- `groupMemberships`
- `more.evidence`

When a group has more leads, `more.groupCandidates` is a prepared follow-up payload for the same `search_sessions` tool. Echo it to request the next bounded page for that group before spending context on line-level evidence.

`more.evidence` is a prepared follow-up payload for the same tool. It carries `query`, optional `queries`, `sources`, `resultsDisplayMode: "evidence"`, and `paths`. It does not preserve `operationalContext`, `context`, `debug`, or caps.

Candidate ranking uses recency, hit density, project matches from `operationalContext`, and Codex current-session demotion when `CODEX_THREAD_ID` exactly matches a Codex candidate `sessionId`. Normal candidate output does not include score fields. To inspect ranking, pass:

```json
{
  "query": "auth token timeout",
  "resultsDisplayMode": "candidates",
  "debug": true
}
```

### Evidence

Unscoped evidence mode returns evidence groups by source and path. Each group includes representative snippets.

Path-restricted evidence returns evidence hits for selected canonical paths:

```json
{
  "query": "auth token timeout",
  "sources": ["codex"],
  "resultsDisplayMode": "evidence",
  "paths": ["/Users/ben/.codex/sessions/session.jsonl"]
}
```

Path-restricted evidence bypasses the default and configured unscoped evidence caps so a selected session is not lost behind unrelated matches. Explicit `maxResultsPerSource` still caps focused evidence per source.

Evidence is bounded matched content, not full transcript content. Evidence hit content is truncated, and evidence groups keep a small number of snippets.

### Debug

Debug mode includes input, expanded patterns, and backend diagnostics. It is for inspecting query expansion and backend behavior. Use candidate mode plus `debug: true` for ranking diagnostics.

## Warnings

Warnings are structured and non-fatal unless all attempted sources fail. Common warning codes include:

- `missing_root`
- `unreadable_root`
- `unknown_source`
- `no_sources_selected`
- `broad_evidence_capped`
- `multi_grep_fallback`
- `all_sources_failed`

Missing or unreadable roots are normal on machines that do not use every supported agent. The search continues across readable roots.
