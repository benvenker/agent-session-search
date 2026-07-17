# Native MCP Opt-In

`agent-session-search-native-mcp` is a separate stdio server for audited raw FFF access. The default managed server remains `agent-session-search-mcp` with exactly one tool, `search_sessions`.

Use the native server only when an advanced agent needs upstream FFF parameters or raw FFF presentation text:

```json
{
  "mcpServers": {
    "agent-session-search-native": {
      "command": "agent-session-search-native-mcp"
    }
  }
}
```

## Tools

The native server lists:

- `fff_native_capabilities`: diagnostic tool for source health, policy version, approved and blocked tools, budgets, root-wide coverage, and restart requirements.
- `fff_grep`: approved source-bound mirror of FFF `grep`.
- `fff_multi_grep`: approved source-bound mirror of FFF `multi_grep`.

Every mirrored tool requires `source`. The source enum contains healthy configured roots from the server startup snapshot. Restart the native server after config edits or FFF upgrades.

## Safety Contract

Native exposure is fail-closed by checked-in policy and full-definition fingerprints. Unknown tools, definition drift, unsafe schemas, reserved names, source collisions, denied classifications, and unapproved tools stay out of `tools/list` and appear only in `fff_native_capabilities`.

Native calls are root-wide for the selected canonical root. Managed `include` patterns are shown in diagnostics for awareness, but they are not a native security boundary. Raw FFF results are presentation text; the native lane does not add managed ranking, truncation, include filtering, canonical-path rewriting, or typed result schemas.

Budgets are process-local and reset on restart:

- 256 attempted upstream calls
- 4 concurrent upstream calls
- 15 second upstream timeout
- default `maxResults` 50
- `maxResults` ceiling 200
- 4 MiB serialized-result ceiling

Code Mode and an importable SDK are deferred frontends. This binary is the only shipped raw FFF opt-in lane.
