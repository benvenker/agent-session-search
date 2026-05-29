# Agent Session Search

Repo-local guidance for coding agents working in this project.

## Project Shape

- This is a TypeScript ESM package that exposes a local MCP server and CLI for searching coding-agent session history.
- Keep the public MCP surface centered on the single `search_sessions` tool.
- Treat FFF as the search engine. Do not add custom indexing, embeddings, SQLite search stores, markdown session exports, or session aggregation unless explicitly requested.
- Preserve canonical absolute paths in search results and keep source/root metadata attached to hits.
- Use `DESIGN.md` as the current design record. Track deferred implementation work in Beads instead of reviving the completed PRD.

## Development Commands

- Install dependencies: `npm install`
- Typecheck: `npm run check`
- Test: `npm test`
- Build: `npm run build`
- Run MCP server in development: `npm run dev:mcp`
- Run CLI smoke path: `npm run dev:cli -- "auth token timeout" --json`

## Agent skills

### Issue tracker

Planning/spec drafts live in local markdown; implementation-ready work lives in Beads via `br`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default Matt Pocock triage roles, including `ready-for-agent` for AFK-ready beads. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo; read `DESIGN.md`, root `CONTEXT.md`, and `docs/adr/` when present. See `docs/agents/domain.md`.

### Beads and swarms

Use the local Beads, BV, and NTM operating guide before converting plans to Beads or launching agent swarms. See `docs/agents/beads-and-swarms.md`.

### Prototype lifecycle

Prototype in throwaway worktrees when useful, but merge durable findings before planning. Keep evidence in `docs/prototypes/`, synthesize implementation plans in `docs/plans/`, then convert stable plans to Beads. See `docs/agents/prototyping.md`.

## Planning And Prototypes

- Use `docs/plans/` for accepted development plans and PRDs that should guide future Beads or implementation.
- Use `docs/prototypes/` for durable prototype findings, evaluation data, and review artifacts.
- Prototype worktrees should merge prototype knowledge before implementation code. Do not merge prototype code into mainline just because the findings are useful.
- Before creating Beads from multiple prototype findings, consolidate overlapping ideas into a plan or PRD so narrow product-surface changes do not become conflicting task graphs.

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
