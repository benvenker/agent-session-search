# Agent Session Search

[![npm](https://img.shields.io/npm/v/@benvenker/agent-session-search.svg)](https://www.npmjs.com/package/@benvenker/agent-session-search)
[![license](https://img.shields.io/npm/l/@benvenker/agent-session-search.svg)](./LICENSE)
![node](https://img.shields.io/badge/node-%3E%3D22.12.0-339933)

Local MCP server and CLI for searching coding-agent session history across Codex, Claude Code, Gemini, Cursor, Pi, Hermes, Pool, and configured text transcript roots.

Agent Session Search wraps [FFF][fff]. It keeps raw session files as the source of truth, fans out one lexical search across enabled source roots, and returns canonical absolute paths plus bounded evidence.

[fff]: https://dmtrkovalenko.dev/blog/just-build-fast-tools

## What It Does

- Exposes one managed MCP tool: `search_sessions`.
- Ships a separate opt-in native MCP server, `agent-session-search-native-mcp`, for approved raw FFF tools.
- Ships a matching CLI: `agent-session-search`.
- Uses `agent-session-search-doctor --json` to expose agent-readable FFF, source, and orphan diagnostics.
- Searches local text transcript roots only. It does not add embeddings, summaries, or a custom session database.

## Install

Prerequisites:

- Node `>=22.12.0`
- `fff-mcp` on `PATH`

Install the package:

```bash
npm install -g @benvenker/agent-session-search
agent-session-search-doctor --json
```

If `fff-mcp` is missing, the package postinstall prints non-destructive install guidance. It does not change a user-owned FFF installation.

Manual FFF install:

```bash
curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash
agent-session-search-doctor --json
```

Review the installer before piping it to a shell: <https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh>. The current documented stable FFF MCP release for this package is `v0.9.6`; doctor JSON reports the installed version, stable-version guidance, multi_grep support, recall-equivalence smoke status, source diagnostics, orphan diagnostics when requested, and the same upgrade command and installer path. Version guidance is advisory when live sequential `grep` remains usable. Success writes one JSON object to stdout; parse and runtime failures write one JSON object to stderr with exit code `1`, `3`, or `4`.

## Quick Start

Inspect the enabled source roots:

```bash
agent-session-search sources --json
```

Search from the CLI:

```bash
agent-session-search "auth token timeout" --json
```

Narrow a search to recent sessions from one workspace:

```bash
agent-session-search "auth token timeout" --json --days 7 --workspace /absolute/path/to/repo
```

`--days` and `--workspace` are deterministic session filters applied before result caps, not ranking hints. The MCP tool accepts the matching `days` and `workspace` fields. See the [CLI reference](docs/cli.md) for matching semantics.

Register the MCP server with a client:

```json
{
  "mcpServers": {
    "agent-session-search": {
      "command": "agent-session-search-mcp"
    }
  }
}
```

The managed server is the default and still lists exactly one tool. Advanced agents can opt in to the native FFF lane with a separate server entry:

```json
{
  "mcpServers": {
    "agent-session-search-native": {
      "command": "agent-session-search-native-mcp"
    }
  }
}
```

The native server exposes `fff_native_capabilities` plus approved tools such as `fff_grep` and `fff_multi_grep`. Every native call requires `source`. Native calls inspect the selected canonical root, return raw FFF presentation text, and do not enforce managed `include` filters. Config or FFF schema changes require restarting the native server.

### Optional cm interoperability

The package also ships `agent-session-search-cass-shim`, an optional subprocess adapter for pinned cm/cass compatibility. It searches live through the same index-free engine and does not add an MCP tool or server; the managed MCP surface remains exactly `search_sessions`. See the [cass shim reference](docs/cass-shim.md) for supported verbs, activation, diagnostics, caveats, and rollback.

Call the MCP tool:

```json
{
  "query": "Find the prior session about PR 227 and the paper-cuts branch.",
  "queries": ["PR #227", "paper-cuts", "poolside-studio pull 227"],
  "operationalContext": {
    "cwd": "/Users/ben/code/poolside/poolside-studio",
    "branch": "paper-cuts",
    "reason": "Recover the prior session that worked on this PR."
  },
  "sources": "all"
}
```

Use `query` for the concise recall task. Use `queries` for short literal planned probes. Put cwd, branch, repo, and reason in `operationalContext` so useful context does not become search text. Optional `days` and `workspace` fields apply the same deterministic session filters as the CLI flags.

## Candidates And Evidence

The default result mode is `candidates` with `resultsShape: "candidate_groups"`. Results are ordered match groups, each with counts, compact leads, and optional `more.groupCandidates` for the next page of that group.

```json
{
  "resultsDisplayMode": "candidates",
  "resultsShape": "candidate_groups",
  "metadata": {
    "contractVersion": "progressive-evidence-groups.v2",
    "backend": { "mode": "multi_grep" }
  },
  "results": [
    {
      "id": "exact_or_structured",
      "assignedCandidateCount": { "value": 3, "relation": "eq" },
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

When a promising group has more leads, pass the prepared payload back as `groupCandidates`, for example `{ "query": "auth token timeout", "groupCandidates": <more.groupCandidates> }`. Clients that support exact top-level argument echoing can also send the `more.groupCandidates` object itself; the server normalizes that shorthand. The CLI can replay the same payload:

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

```bash
agent-session-search --json --group-candidates @payload.json
```

Then echo a selected candidate's `more.evidence` object back to `search_sessions` to get bounded matched content for that session:

```json
{
  "query": "auth token timeout",
  "sources": ["codex"],
  "resultsDisplayMode": "evidence",
  "paths": ["/absolute/session.jsonl"]
}
```

The equivalent CLI form is:

```bash
agent-session-search "auth token timeout" --json --evidence \
  --path /Users/ben/.codex/sessions/session.jsonl
```

Candidate ranking uses recency, hit density, project matches from `operationalContext`, and current-session demotion. Pass `callerSession` with a reliable source and session id to demote the matching live session for any source. `CODEX_THREAD_ID` remains a Codex-only fallback when `callerSession` is absent. Normal candidate output does not include score fields. For ranking diagnostics, use `--candidates --debug` or MCP input with `"resultsDisplayMode": "candidates"` and `"debug": true`.

## Configuration

Default config path:

```text
~/.config/agent-session-search/config.json
```

Override it with `AGENT_SESSION_SEARCH_CONFIG`.

Built-in source roots:

| Source   | Default root                             | Notes                                             |
| -------- | ---------------------------------------- | ------------------------------------------------- |
| `codex`  | `~/.codex`                               | Includes `sessions` and `archived_sessions`.      |
| `claude` | `~/.claude/projects`                     | Claude Code project transcripts.                  |
| `pi`     | `~/.pi/agent/sessions`                   | Pi session records.                               |
| `cursor` | `~/.cursor/projects`                     | Cursor agent transcript paths.                    |
| `hermes` | `~/.hermes/sessions`                     | Hermes session records.                           |
| `gemini` | `~/.gemini/tmp`                          | Gemini CLI chat JSON and logs.                    |
| `pool`   | `~/Library/Application Support/poolside` | Shared Pool CLI and Poolside Studio history root. |

Add a custom text transcript root without re-declaring the built-ins:

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

## Documentation

- [CLI reference](docs/cli.md)
- [MCP tool contract](docs/mcp.md)
- [Native MCP opt-in](docs/native-mcp.md)
- [Optional cass shim for cm interoperability](docs/cass-shim.md)
- [Configuration](docs/configuration.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Release process](docs/maintainers/release.md)
- [Contribution policy](CONTRIBUTING.md)
- [Design record](DESIGN.md)

## Development

```bash
npm install
npm run check:fff
npm run check
npm test
npm run build
npm run smoke
npm run dev:mcp
npm run dev:cli -- "auth token timeout" --json
```

`npm run check:fff` runs the same FFF dependency preflight exposed as `agent-session-search-doctor` in the installed package.

`npm run build` also restores executable bits on the `dist/` entrypoints (tsc drops them), so run it after cloning or pulling before invoking `dist/` bins directly — `node dist/...` works regardless.

## Limitations

- Search is lexical. If the text never appears in a session file or planned probe, Agent Session Search cannot infer it semantically.
- Evidence is bounded matched content, not full-file transcript retrieval.
- SQLite-only or binary session stores need an export path before FFF can search them.
- Results cover the session files available to the current machine and user.
- `fff-mcp` must be installed and runnable for real searches.
- Native FFF access is opt-in, root-wide, bounded by local policy and budgets, and not a Code Mode or importable SDK surface.

## License

MIT. See [LICENSE](./LICENSE).
