# Agent Session Search

Repo-local guidance for coding agents working in this project.

## Project Shape

- This is a TypeScript ESM package that exposes a local MCP server and CLI for searching coding-agent session history.
- `agent-session-search-mcp` is the managed MCP server and exposes only `search_sessions`; `agent-session-search-native-mcp` is the separate opt-in native MCP server for audited raw FFF access.
- Keep the managed MCP surface centered on the single `search_sessions` tool; raw FFF access belongs only in the separate opt-in native MCP lane described by `DESIGN.md`.
- Treat FFF as the search engine. Do not add custom indexing, embeddings, SQLite search stores, markdown session exports, or session aggregation unless explicitly requested.
- Preserve canonical absolute paths in search results and keep source/root metadata attached to hits.
- Use `DESIGN.md` as the current design record. Track deferred implementation work in Beads instead of reviving the completed PRD.

## Development Commands

- Use Node `>=22.12.0`; `nvm use` reads the repo `.nvmrc` and selects Node 24 LTS.
- Install dependencies: `npm install`
- Typecheck: `npm run check`
- Test: `npm test`
- Build: `npm run build`
- Run managed MCP server in development: `npm run dev:mcp`
- Run CLI smoke path: `npm run dev:cli -- "auth token timeout" --json`

## Smithers

- Smithers is installed repo-locally under `.smithers/`; it provides durable workflow orchestration for larger agent tasks.
- Invoke the CLI as `bunx smithers-orchestrator <command>`. Do not use `bunx smithers`; the Smithers docs note that `smithers` is an unrelated npm package name.
- Project MCP config lives in `.mcp.json` and registers Smithers with `bunx smithers-orchestrator --mcp`.
- List available local workflows with `bunx smithers-orchestrator workflow list --format md`.
- Validate the workflow pack with `cd .smithers && bun run typecheck`.
- Generated per-command Smithers skills under `.agents/skills/` are local agent artifacts and remain ignored by this repo; the checked-in `cass-shim-control` skill is the deliberate exception.

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

Prototype in throwaway worktrees when useful, but merge durable findings before planning. Keep findings in `docs/prototypes/findings/`, synthesize implementation plans in `docs/plans/`, then convert stable plans to Beads. See `docs/agents/prototyping.md`.

### cm shim control

The cass-compat shim is opt-in; its on/off switch is cm-side (`CASS_PATH` env or cm `cassPath` config), never in this package. Agents must not activate it unprompted or rewrite cm configuration outside an explicit user request. See the shipped skill `.agents/skills/cass-shim-control/SKILL.md` (levers, status checks, setup flow, guardrails); `.claude/skills/cass-shim-control` symlinks to it for Claude Code discovery.

## Planning And Prototypes

- Use `docs/plans/` for accepted development plans and PRDs that should guide future Beads or implementation.
- Use `docs/prototypes/findings/` for durable prototype findings and evaluation data.
- Prototype worktrees should merge prototype knowledge before implementation code. Do not merge prototype code into mainline just because the findings are useful.
- Before creating Beads from multiple prototype findings, consolidate overlapping ideas into a plan or PRD so narrow product-surface changes do not become conflicting task graphs.

## Implementation Notes

- Prefer small, testable modules behind the managed MCP tool and native opt-in policy boundary: root resolution, query rewriting, FFF backend/router, fanout coordination, path normalization, response shaping, and fail-closed native exposure.
- Missing or unreadable source roots should produce warnings without failing the whole search.
- Query rewriting should be deterministic by default and emit a small set of literal FFF-friendly patterns.
- Keep output close to the FFF result shape. Do not add opaque ranking signals or automatic summarization.

## Built-In Source Notes

- Pool is intentionally modeled as one `pool` source rooted at `~/Library/Application Support/poolside` on macOS. That shared root covers Pool CLI history (`trajectories/`, `logs/`, `sessions/`) and Poolside Studio agent records (`acp/`). Do not split it into separate Pool CLI and Poolside Studio built-ins unless the on-disk storage changes.
- Pool's binary install path is not the session-history path. Use `pool config` to verify the log and trajectory directories, especially on non-macOS installs or machines with custom Pool configuration.

## Guardrails

- **Destructive Command Guard (DCG)** is installed globally and its PreToolUse hook is registered in Claude Code (global, not repo-local). This repo carries project-specific DCG packs in `.dcg.toml` (currently `platform.github`) and a validation script. It blocks dangerous commands (e.g. `git reset --hard`, broad `rm -rf`, `gh repo delete`) before they run. If DCG blocks a command, find a safe alternative from the DCG skill workflow; do not silently retry or ask for an override without first explaining the risk and alternatives.
- Run `npm run check:dcg` to verify DCG is active.
- Avoid broad refactors when changing behavior; update focused tests for the module touched.
- Before finishing code changes, run `npm run check` and the relevant tests, or explain why they were not run.

## Session Recall

- Start non-trivial tasks with procedural memory: `cm context "<one-line task description>" --json --log-context` returns relevant rules, anti-patterns, and past-session snippets. Treat its output as advisory, not authoritative. The `--log-context` flag records rule usage for cm's implicit feedback loop — keep it on.
- For session archaeology ("what did we decide about X?"), search the local corpus with cass: `cass search "KEYWORD" --workspace /data/projects/agent-session-search --json --fields minimal --limit 20`. Refresh only when `cass status --json` reports `index.stale`, and cap every `cass index` call with `timeout`.
- Leave feedback for the learning loop when a cited rule helps or hurts: inline comments (`// [cass: helpful b-xxx]` / `// [cass: harmful b-xxx]`, parsed by the nightly reflect) or immediate `cm mark <id> --helpful|--harmful`. Manual `cm reflect --days 1 --json` after significant work is optional, not required.
