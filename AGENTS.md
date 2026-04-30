# Agent Session Search

Repo-local guidance for coding agents working in this project.

## Project Shape

- This is a TypeScript ESM package that exposes a local MCP server and CLI for searching coding-agent session history.
- Keep the public MCP surface centered on the single `search_sessions` tool.
- Treat FFF as the search engine. Do not add custom indexing, embeddings, SQLite search stores, markdown session exports, or session aggregation unless explicitly requested.
- Preserve canonical absolute paths in search results and keep source/root metadata attached to hits.

## Development Commands

- Install dependencies: `npm install`
- Typecheck: `npm run check`
- Test: `npm test`
- Build: `npm run build`
- Run MCP server in development: `npm run dev:mcp`
- Run CLI smoke path: `npm run dev:cli -- "auth token timeout" --json`

## Implementation Notes

- Prefer small, testable modules behind the single MCP tool: root resolution, query rewriting, FFF backend, fanout coordination, path normalization, and response shaping.
- Missing or unreadable source roots should produce warnings without failing the whole search.
- Query rewriting should be deterministic by default and emit a small set of literal FFF-friendly patterns.
- Keep output close to the FFF result shape; avoid inventing ranking or summarization in v1.

## Built-In Source Notes

- Pool is intentionally modeled as one `pool` source rooted at `~/Library/Application Support/poolside` on macOS. That shared root covers Pool CLI history (`trajectories/`, `logs/`, `sessions/`) and Poolside Studio agent records (`acp/`). Do not split it into separate Pool CLI and Poolside Studio built-ins unless the on-disk storage changes.
- Pool's binary install path is not the session-history path. Use `pool config` to verify the log and trajectory directories, especially on non-macOS installs or machines with custom Pool configuration.

## Guardrails

- Avoid broad refactors when changing behavior; update focused tests for the module touched.
- Before finishing code changes, run `npm run check` and the relevant tests, or explain why they were not run.
