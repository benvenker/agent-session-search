# Phase 0 Scope Decision

Target: `/Users/ben/code/agent-session-search`
Branch: `main`
Starting SHA: `decf02dcccb0f063b56c9d202297ff82ed9798cc`
Mode: `full`
Triangulation: subagents requested; use read-only subagents for surface review and session mining, then local implementation.
Session mining: use `agent-session-search` CLI/MCP only. Do not use CASS because it is not functional on this machine.

Guardrails:

- Keep the public MCP surface centered on the single `search_sessions` tool.
- Treat FFF as the search engine; do not add custom indexing, embeddings, SQLite stores, markdown session exports, or session aggregation.
- Preserve canonical absolute paths and source/root metadata in search results.
- Keep this tool simple while still adding high-leverage agent-facing affordances.
- Add focused tests for touched modules.
- Run `npm run check` and relevant tests before finishing.

Preflight notes:

- The upstream ergonomics skill preflight expects GNU `flock` and `timeout`, which are not installed on this macOS machine.
- The pass continues with manual in-tree artifacts and repo-native validation rather than installing system tools.
- Runtime help checks use the local package entrypoints, not only the globally installed shim.
