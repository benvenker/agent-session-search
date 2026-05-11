# Agent Ergonomics Pass 1 Handoff

Target: `/Users/ben/code/agent-session-search`
Branch: `main`
Mode: `full`

What changed:

- `agent-session-search capabilities --json`
- `agent-session-search robot-docs guide`
- `agent-session-search --robot-triage`
- `agent-session-search --json --help` as a machine-readable capabilities alias
- `--probe`/`--query`, `--cwd`, `--branch`, and `--reason` CLI flags mapped to `SearchSessionsInput`
- JSON stderr error envelope for JSON-mode parse failures
- CLI search pool cleanup after each run
- `agent-session-search-doctor --help`
- recovery hints for unknown source filters

Validation run:

- `npm run check`
- `npm run build`
- `npx vitest run test/cli.test.ts test/fff-preflight.test.ts test/search.test.ts test/readme.test.ts`
- `npm test`
- `npm run smoke`
- `npm run check:beads`
- `npm run check:fff -- --skip-smoke`
- dist command smokes for capabilities, robot triage, doctor help, JSON errors, and real search exit

Deferred pass 2 candidates:

- Verify whether FastMCP can return structured content directly instead of JSON string text.
- Align MCP server version with `package.json`.
- Consider a `sources --json` or richer config-inspection subcommand only if it can stay inside the simple v1 contract.
