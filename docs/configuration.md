# Configuration

Agent Session Search loads built-in source roots, then merges optional user config from:

```text
~/.config/agent-session-search/config.json
```

Override that path with `AGENT_SESSION_SEARCH_CONFIG`.

## Built-In Sources

| Source   | Default root                             | Include patterns                                                                                       |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `codex`  | `~/.codex`                               | `sessions/*.jsonl`, `sessions/**/*.jsonl`, `archived_sessions/*.jsonl`, `archived_sessions/**/*.jsonl` |
| `claude` | `~/.claude/projects`                     | `*.jsonl`                                                                                              |
| `pi`     | `~/.pi/agent/sessions`                   | `*`                                                                                                    |
| `cursor` | `~/.cursor/projects`                     | `*/agent-transcripts/**/*.jsonl`, `*/agent-transcripts/**/*.json`                                      |
| `hermes` | `~/.hermes/sessions`                     | `*`                                                                                                    |
| `pool`   | `~/Library/Application Support/poolside` | `trajectories/*.ndjson`, `logs/*.log`, `sessions/*.json`, `acp/**/*.json`                              |

Codex live and archived sessions stay under the single `codex` source. Pool is modeled as one `pool` source rooted at the shared Pool history directory; the Pool binary install path is not the session-history path.

## Config File

Example:

```json
{
  "roots": [
    {
      "name": "goose",
      "path": "/Users/ben/.goose/sessions",
      "include": ["*.jsonl"]
    },
    {
      "name": "claude",
      "path": "/Users/ben/custom-claude-projects",
      "include": ["*.jsonl"]
    },
    {
      "name": "pi",
      "path": "/Users/ben/.pi/agent/sessions",
      "enabled": false
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

Configured roots with the same name replace built-ins. New names add configured sources. Set `"enabled": false` to disable a source without deleting its config.

You do not need to re-declare built-ins to add a new source.

## Include Patterns

`include` filters returned paths after FFF search:

- No `include`, or `include: ["*"]`, accepts every path under the source root.
- Slashless patterns such as `"*.jsonl"` match basenames anywhere under the source root.
- Patterns containing `/` match root-relative paths.
- `*` matches within one path segment.
- `**` matches across path segments.

## Defaults

`defaults.maxPatterns`, `defaults.maxResultsPerSource`, and `defaults.context` are optional. Request fields override config defaults.

The current backend treats `context` as reserved. FFF results remain bounded matching lines rather than surrounding-line reads.

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

For MCP clients, put environment variables in the server entry's `env` block. For CLI use, export them in your shell.

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

Pool stores personal MCP server settings in `~/.config/poolside/settings.yaml` and can also read project-scoped settings from `.poolside/settings.yaml`. Command-based MCP servers inherit the environment of the `pool` process.
