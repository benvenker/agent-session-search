# Live MCP and CLI testing for agents

How agents (human- or machine-driven) interact with a **live** version of the
agent-session-search MCP servers and CLI without publishing to npm.

## The two servers

| Binary                                                      | Lane            | Tools                                                   |
| ----------------------------------------------------------- | --------------- | ------------------------------------------------------- |
| `agent-session-search-mcp` (`dist/server.js`)               | managed         | exactly `search_sessions`                               |
| `agent-session-search-native-mcp` (`dist/native-server.js`) | native (opt-in) | `fff_native_capabilities`, `fff_grep`, `fff_multi_grep` |

## Keep the build fresh

- `npm run build` — refreshes `dist/`; every mechanism below serves this output.
- `npm run dev:cli -- "query" --json` / `npm run dev:mcp` — tsx, always current
  source; prefer for quick interactive probes, not for harness registration.

## Interactive use: npm link

`npm link` once in the repo root makes the four bins resolve globally to local
`dist/` (`agent-session-search`, `-doctor`, `-mcp`, `-native-mcp`). Any agent
harness whose MCP config names the bare command then gets the local build;
`npm run build` refreshes it. Remove with `npm unlink -g` in the repo root.
Treat this as a convenience for humans, not as eval infrastructure.

## Hermetic per-invocation configs (eval and testing)

For reproducible agent testing, register the servers **per process** with
absolute paths — no global state:

```json
{
  "mcpServers": {
    "agent-session-search": {
      "command": "node",
      "args": ["/data/projects/agent-session-search/dist/server.js"]
    },
    "agent-session-search-native": {
      "command": "node",
      "args": ["/data/projects/agent-session-search/dist/native-server.js"]
    }
  }
}
```

- **Claude Code**: `claude --mcp-config <file.json>` (Smithers `ClaudeCodeAgent`:
  `mcpConfig: [path]`).
- **Kimi**: `kimi --mcp-config-file <file.json>` (Smithers `KimiAgent`:
  `mcpConfigFile: [path]`).
- **Codex**: config overrides, e.g.
  `codex -c 'mcp_servers.agent-session-search.command="node"' -c 'mcp_servers.agent-session-search.args=["/data/projects/agent-session-search/dist/server.js"]'`
  (Smithers `CodexAgent`: `config: { mcp_servers: { ... } }`).

The `mcp-eval-council` Smithers workflow generates these files under
`.smithers/tmp/eval/` at run time (absolute paths resolved then), builds first,
and probes both servers for an objective `tools/list` baseline.

## Quick manual probes

```bash
# Managed lane must advertise exactly one tool
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node dist/server.js

# Native lane: capabilities + namespaced tools with required source enum
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node dist/native-server.js

# CLI
agent-session-search capabilities --json
agent-session-search-doctor --json
agent-session-search "auth token timeout" --json
```

## Multi-model evaluation

`bunx smithers-orchestrator workflow run mcp-eval-council --detach` builds the
repo, probes both servers, fans out live-interaction evaluators (Kimi K3,
GPT 5.6 Sol xhigh/high, Claude Fable) that call the MCP tools and CLI directly,
and synthesizes a rating report at
`docs/investigations/fff-pass-through/evals/`.
