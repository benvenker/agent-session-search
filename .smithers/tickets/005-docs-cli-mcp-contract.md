# U5 CLI, MCP, And Documentation Contract

## Objective

Document and expose the grouped progressive-evidence flow through CLI help, MCP docs, capabilities output, README examples, and smoke tests.

## Source Plan

Follow `/data/projects/agent-session-search/docs/plans/2026-06-18-001-feat-fff-native-progressive-evidence-plan.md`, especially U5 and requirements R6, R8, R9, R11, R13, R15, R16, and R17.

## Scope

- Update `README.md`, `DESIGN.md`, `UBIQUITOUS_LANGUAGE.md`, `docs/mcp.md`, `docs/cli.md`, `docs/configuration.md`, `docs/troubleshooting.md`, `src/help.ts`, `test/cli.test.ts`, and `test/readme.test.ts` as needed.
- Describe match groups, candidate groups, count relation semantics, `hasMore`, group follow-ups, candidate evidence, warnings, and recommended actions.
- Keep docs aligned with the single `search_sessions` MCP tool surface.
- Make examples agent-friendly and copy-ready without requiring external docs to know the next action.

## Acceptance Criteria

- Capabilities/help mention `candidate_groups`, group expansion, focused evidence, and relevant contract/version metadata.
- README and MCP docs include a concise default candidate-group example and follow-up example.
- Troubleshooting explains backend fallback, `multi_grep` availability, and malformed follow-up corrections.
- CLI JSON stdout remains parseable and diagnostics stay separate.

## Verification

- Run CLI, README, MCP smoke, and docs-oriented tests.
- Run `npm run check`.
