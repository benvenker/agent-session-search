# Agent Session Search

[![npm](https://img.shields.io/npm/v/@benvenker/agent-session-search.svg)](https://www.npmjs.com/package/@benvenker/agent-session-search)
[![license](https://img.shields.io/npm/l/@benvenker/agent-session-search.svg)](./LICENSE)
![node](https://img.shields.io/badge/node-%3E%3D22.12.0-339933)

Local MCP server and CLI for searching coding-agent session history across Codex, Claude Code, Gemini, Cursor, Pi, Hermes, Pool, and configured text transcript roots.

Agent Session Search wraps [FFF][fff]. It keeps raw session files as the source of truth, fans out one lexical search across enabled source roots, and returns canonical absolute paths plus bounded evidence.

[fff]: https://dmtrkovalenko.dev/blog/just-build-fast-tools

## What It Does

- Exposes one MCP tool: `search_sessions`.
- Ships a matching CLI: `agent-session-search`.
- Uses `agent-session-search-doctor` to verify `fff-mcp` and inspect orphaned FFF children.
- Searches local text transcript roots only. It does not add embeddings, summaries, or a custom session database.

## Install

Prerequisites:

- Node `>=22.12.0`
- `fff-mcp` on `PATH`

Install the package:

```bash
npm install -g @benvenker/agent-session-search
agent-session-search-doctor
```

If `fff-mcp` is missing, the package postinstall prints non-destructive install guidance. It does not change a user-owned FFF installation.

Manual FFF install:

```bash
curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash
agent-session-search-doctor
```

Review the installer before piping it to a shell: <https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh>. The current documented stable FFF MCP release for this package is `v0.9.4`; doctor reports the installed version, multi_grep support, recall-equivalence smoke status, and the same upgrade command.

## Quick Start

Inspect the enabled source roots:

```bash
agent-session-search sources --json
```

Search from the CLI:

```bash
agent-session-search "auth token timeout" --json
```

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

Use `query` for the concise recall task. Use `queries` for short literal planned probes. Put cwd, branch, repo, and reason in `operationalContext` so useful context does not become search text.

## Candidates And Evidence

The default result mode is `candidates` with `resultsShape: "candidate_groups"`. Results are ordered match groups, each with counts, compact leads, and optional `more.groupCandidates` for the next page of that group.

```json
{
  "resultsDisplayMode": "candidates",
  "resultsShape": "candidate_groups",
  "metadata": {
    "contractVersion": "progressive-evidence-groups.v1",
    "backend": { "mode": "multi_grep" }
  },
  "results": [
    {
      "id": "exact_or_structured",
      "assignedCandidateCount": { "value": 3, "relation": "eq" },
      "hasMore": true,
      "more": { "groupCandidates": { "resultsDisplayMode": "candidates" } },
      "leads": [
        { "path": "/absolute/session.jsonl", "more": { "evidence": {} } }
      ]
    }
  ]
}
```

Echo `more.groupCandidates` back to `search_sessions` first when a promising group has more leads. Then echo a selected candidate's `more.evidence` object back to `search_sessions`, or use the equivalent CLI form, to get bounded matched content for that session:

```bash
agent-session-search "auth token timeout" --json --evidence \
  --path /Users/ben/.codex/sessions/session.jsonl
```

Candidate ranking uses recency, hit density, project matches from `operationalContext`, and Codex current-session demotion when `CODEX_THREAD_ID` matches the candidate session id. Normal candidate output does not include score fields. For ranking diagnostics, use `--candidates --debug` or MCP input with `"resultsDisplayMode": "candidates"` and `"debug": true`.

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

## Limitations

- Search is lexical. If the text never appears in a session file or planned probe, Agent Session Search cannot infer it semantically.
- Evidence is bounded matched content, not full-file transcript retrieval.
- SQLite-only or binary session stores need an export path before FFF can search them.
- Results cover the session files available to the current machine and user.
- `fff-mcp` must be installed and runnable for real searches.

## License

MIT. See [LICENSE](./LICENSE).
