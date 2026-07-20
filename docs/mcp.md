# MCP Tool Contract

The managed server (`agent-session-search-mcp`) exposes one MCP tool: `search_sessions`.

Raw FFF access is available only through the separate opt-in native server (`agent-session-search-native-mcp`). See [Native MCP opt-in](native-mcp.md). The native server does not add tools or modes to `search_sessions`.

The implementation returns JSON as MCP text content. It does not currently advertise an `outputSchema`; this behavior is pinned by tests while the FastMCP wrapper path returns successful tool results as string/content-style values.

The stdio server checks the external `fff-mcp` binary before the MCP handshake. If `fff-mcp` is missing or below `v0.9.6`, `agent-session-search-mcp` exits with code `3` and prints install/upgrade guidance. Run `agent-session-search-doctor --json` for agent-readable setup diagnostics, or `agent-session-search-doctor --ensure-fff --yes` when you explicitly want doctor to run the official installer.

Doctor JSON is a CLI diagnostic surface, not an MCP tool. Success writes one object to stdout with `ok: true`, `contractVersion: "1.0"`, backend identity fields, structured `checks`, `sourceDiagnostics`, and `orphans`; parse and runtime failures write one object to stderr with `ok: false`, `error.code`, and `exitCode`. A success object carries backend identity such as `"command":"fff-mcp"` and source health under `"sourceDiagnostics":{"configPath": ...}`. Exit codes match the CLI convention: `0` success, `1` user-input error, `3` tool-environment error, and `4` upstream failure.
When the live smoke path runs, doctor also checks that `agent-session-search-native-mcp` can start and list `fff_native_capabilities`.

Compact success excerpt with `checks` shortened:

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
| `callerSession`       | Optional reliable caller identity with `source` and `sessionId`; the matching live session is demoted.           |
| `sources`             | Optional array such as `["codex", "claude"]`, or `"all"` for every enabled source. Omit to search enabled roots. |
| `resultsDisplayMode`  | `candidates`, `evidence`, or `debug`. Defaults to `candidates`, unless `debug: true` is supplied alone.          |
| `paths`               | Restrict evidence results to canonical session paths.                                                            |
| `maxPatterns`         | Limit expanded literal patterns.                                                                                 |
| `maxResultsPerSource` | Limit results per source. Explicit caps still apply to focused path evidence.                                    |
| `context`             | Reserved for backend support. Current FFF results remain bounded matching lines.                                 |
| `days`                | Positive integer rolling age window based on session-file mtime.                                                 |
| `workspace`           | Non-empty workspace path used for deterministic session filtering. MCP clients should pass an absolute path.     |
| `debug`               | Include query expansion and diagnostics. Candidate ranking diagnostics require candidate mode plus debug.        |

`days` and `workspace` are deterministic filters, not ranking inputs. Workspace matching uses physical path containment, an exact encoded-directory component (never a prefix), or recorded `cwd`/`projectRoot` metadata within the workspace; workspace subdirectories are included. When both filters are present they compose with AND: a session must satisfy the rolling cutoff and the workspace predicate. The response echoes supplied values under `metadata.filters`, including the canonical workspace. MCP clients and the companion shim should pass an absolute workspace path because relative input resolves against the managed server cwd; CLI relative paths resolve against the CLI process cwd.

## Result Modes

### Candidates

Default mode. `resultsShape` is `candidate_groups`. Results are ordered static match groups; each group contains compact session-level candidate leads grouped by `source` and canonical `path`.

Top-level `metadata` includes `contractVersion`, backend mode, limits, and count semantics. Backend mode is one of `multi_grep`, `sequential_grep`, `sequential_grep_fallback`, or `custom`; fallback responses include `metadata.backend.fallbackReason`.

Candidate groups include `id`, `priority`, `label`, `guidance`, `patternIds`, `assignedCandidateCount`, `hitCount`, `shownLeadCount`, `hasMore`, and `leads`. `assignedCandidateCount` and `hitCount` use `{ "value": number, "relation": "eq" | "gte" }` so callers can tell exact counts from lower bounds; `shownLeadCount` is a plain number of leads included in the current response. Empty groups are omitted.

Concise default response shape:

```json
{
  "resultsDisplayMode": "candidates",
  "resultsShape": "candidate_groups",
  "metadata": {
    "contractVersion": "progressive-evidence-groups.v2",
    "backend": { "mode": "multi_grep" },
    "countRelationSemantics": {
      "eq": "exact count",
      "gte": "lower bound because a cap or backend budget may hide more"
    }
  },
  "results": [
    {
      "id": "exact_or_structured",
      "label": "Exact or structured evidence",
      "assignedCandidateCount": { "value": 3, "relation": "eq" },
      "shownLeadCount": 1,
      "hasMore": true,
      "more": {
        "groupCandidates": {
          "query": "auth token timeout",
          "sources": ["codex"],
          "resultsDisplayMode": "candidates",
          "planFingerprint": "gcp1:server-prepared",
          "fingerprint": "gcf1:server-prepared",
          "group": {
            "id": "exact_or_structured",
            "priority": 0,
            "patternIds": ["p1"]
          },
          "offset": 5,
          "limit": 5
        }
      },
      "leads": [
        {
          "path": "/absolute/session.jsonl",
          "more": {
            "evidence": {
              "query": "auth token timeout",
              "sources": ["codex"],
              "resultsDisplayMode": "evidence",
              "paths": ["/absolute/session.jsonl"]
            }
          }
        }
      ]
    }
  ]
}
```

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

When a group has more leads, `more.groupCandidates` is a prepared follow-up payload for the same `search_sessions` tool. Prefer the schema-shaped call `{ "query": "<same query>", "groupCandidates": <more.groupCandidates> }` to request the next bounded page for that group before spending context on line-level evidence. MCP clients that support exact top-level argument echoing may also send the `more.groupCandidates` object itself; the server normalizes that shorthand. The payload includes the original query shape, resolved sources, candidate display mode, group identity, offset/limit, a `planFingerprint` such as `gcp1:...`, and a `fingerprint` such as `gcf1:...`; do not hand-author or edit it. Prepared group payloads carry `days` and the canonical `workspace` through replay. The cutoff is rolling rather than snapshot-stable, so each replay evaluates the age window at replay time. Focused `more.evidence` payloads remain path-pinned and do not inherit these filters.

Copy-ready group follow-up call:

```json
{
  "query": "auth token timeout",
  "groupCandidates": {
    "query": "auth token timeout",
    "sources": ["codex"],
    "resultsDisplayMode": "candidates",
    "planFingerprint": "gcp1:server-prepared",
    "fingerprint": "gcf1:server-prepared",
    "group": {
      "id": "exact_or_structured",
      "priority": 0,
      "patternIds": ["p1"]
    },
    "offset": 5,
    "limit": 5
  }
}
```

CLI fallback can replay the same prepared group payload:

```bash
agent-session-search --json --group-candidates @payload.json
```

`more.evidence` is a prepared follow-up payload for the same tool. It carries `query`, optional `queries`, `sources`, `resultsDisplayMode: "evidence"`, and `paths`. It does not preserve `operationalContext`, `context`, `debug`, or caps.

Copy-ready focused evidence call:

```json
{
  "query": "auth token timeout",
  "sources": ["codex"],
  "resultsDisplayMode": "evidence",
  "paths": ["/absolute/session.jsonl"]
}
```

Candidate ranking uses recency, hit density, project matches from `operationalContext`, and current-session demotion. When the caller knows its own live session id, pass `callerSession: { "source": "<source>", "sessionId": "<id>" }`; a candidate with the same `source` and `sessionId` is sorted below non-current candidates. `CODEX_THREAD_ID` remains a Codex-only fallback when `callerSession` is absent. Normal candidate output does not include score fields. To inspect ranking, pass:

```json
{
  "query": "auth token timeout",
  "callerSession": {
    "source": "codex",
    "sessionId": "019edba3-fc85-74f1-b391-ef17d86f9985"
  },
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

Warnings are structured and non-fatal unless all attempted sources fail. A warning may include `recommendedAction` when the caller can take a useful next step without inspecting docs. Common warning codes include:

- `missing_root`
- `unreadable_root`
- `unknown_source`
- `no_sources_selected`
- `broad_evidence_capped`
- `multi_grep_fallback`
- `all_sources_failed`
- `filters_removed_all_results`
- `workspace_unknown`

The warning envelope is stable for agents: `source?`, `root?`, `code`, `message`, and `recommendedAction?`. When `recommendedAction` is present, show it alongside the warning and prefer it over inventing a recovery path.

Missing or unreadable roots are normal on machines that do not use every supported agent. The search continues across readable roots. The warning `recommendedAction` points to the concrete recovery path: create the directory, fix permissions, update or disable the source in config, or inspect current roots with `agent-session-search sources --json`.
Source-filter warnings such as `unknown_source` and `no_sources_selected` include a recovery action that points to `agent-session-search sources --json` or omitting the source filter.

`broad_evidence_capped` means an unscoped evidence request hit the default breadth cap. Switch back to candidates, expand a promising group with `more.groupCandidates`, then request focused evidence for the selected path.

`all_sources_failed` includes an `rg` fallback command in the warning message for exhaustive proof-style search. First verify roots and backend health with `agent-session-search sources --json` and `agent-session-search-doctor --json`.

`workspace_unknown` means no session under the resolved roots is associated with the checked canonical workspace. It is a successful empty search, not a hard failure; verify the path named in `recommendedAction` and retry.

`filters_removed_all_results` means a known workspace or the active session filters produced no eligible matches. Use its `recommendedAction` to widen the query or remove `days` or `workspace`.
