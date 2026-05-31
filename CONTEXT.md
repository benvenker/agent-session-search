# Agent Session Search Context

Agent Session Search is a local TypeScript ESM package for searching coding-agent session history. It ships a local MCP server, a CLI, and a setup/diagnostic command so agents and humans can recover prior work across Codex, Claude Code, Cursor, Pi, Hermes, Pool, and configured custom roots.

## Product Shape

- The public MCP surface is the single `search_sessions` tool.
- The CLI uses the same search flow and result shape as the MCP server.
- `agent-session-search-doctor` is for setup, FFF health checks, and orphaned `fff-mcp` process cleanup.
- Raw session files are the source of truth. Results should preserve canonical absolute paths plus `source` and `root` metadata.

## Search Backend

FFF is the search backend. This repo wraps `fff-mcp` by resolving source roots, rewriting queries into deterministic lexical probes, fanning out to one FFF child per root, normalizing paths, ranking default candidates, and shaping results for agents.

Do not add custom indexing, embeddings, SQLite stores, markdown session exports, or durable aggregation without a new design pass. Missing or unreadable roots should produce warnings while other roots continue.

## Key Modules

- `src/roots.ts`: built-in roots, user config loading, source enablement, and path normalization.
- `src/query-rewriter.ts`: deterministic query rewriting and literal probe generation.
- `src/fff-backend.ts`: FFF child process calls and backend result adaptation.
- `src/client-pool.ts` and `src/child-process-cleanup.ts`: FFF child lifecycle and cleanup behavior.
- `src/search.ts`: fanout coordination, filtering, candidate ranking, result grouping, and response shaping.
- `src/tool.ts` and `src/types.ts`: MCP tool input/output contracts and shared types.
- `src/server.ts`: MCP server entry point.
- `src/cli.ts` and `src/help.ts`: CLI commands and agent-readable help.
- `src/fff-preflight.ts`: doctor command and FFF availability checks.

## Behavioral Guardrails

- Keep the one-tool MCP boundary unless `DESIGN.md` changes.
- Prefer small, testable modules behind that boundary.
- Keep query rewriting deterministic by default.
- Keep output close to FFF hits: ranked candidates, evidence groups, evidence hits, warnings, and debug diagnostics.
- Preserve canonical absolute paths in user-visible results.
- Use source-level warnings for partial failures instead of failing the whole search.
- Treat Pool as one `pool` source rooted at the shared Pool history directory unless Pool's on-disk storage model changes.
- Treat Codex archived sessions as part of the single `codex` source rooted at `~/.codex`.
- Keep ranking scores out of normal candidate output; expose them only through candidate-mode debug responses.

## Planning And Work Tracking

- `DESIGN.md` is the current design record.
- `CONTEXT.md` is the quick orientation and vocabulary entry point for future agents.
- `docs/adr/` is for architecture decisions when present.
- Accepted development plans and PRDs live under `docs/plans/`.
- Early planning and scratch notes can live in local markdown such as `.scratch/<feature>/`.
- Durable prototype findings and evaluation data live in `docs/prototypes/findings/`.
- Prototype worktrees should merge findings before code; production code should land through a plan, Beads, or an explicit productionization decision.
- Implementation-ready work lives in Beads via `br`; inspect graph state with `bv --robot-*`, never bare `bv`.
- Repo-local agent setup docs live in `docs/agents/`.
