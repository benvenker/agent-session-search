# U4 Group-Level Progressive Follow-Ups

## Objective

Add bounded group-level candidate expansion while preserving candidate-level focused evidence follow-ups.

## Source Plan

Follow `/data/projects/agent-session-search/docs/plans/2026-06-18-001-feat-fff-native-progressive-evidence-plan.md`, especially U4 and requirements R6, R8, R9, R10, R12, R15, R16, and R17.

## Scope

- Update `src/search.ts`, `src/types.ts`, `src/tool.ts`, `test/search.test.ts`, and `test/tool.test.ts` as needed.
- Add copy-ready `more.groupCandidates` payloads on non-empty groups.
- Ensure group follow-ups are stateless payloads for the same `search_sessions` tool and include original query material, source/path constraints, candidate mode, group discriminator, offset, and limit.
- Re-run discovery deterministically on group follow-up, re-apply canonicalization and group assignment, then slice the requested group at wrapper level.
- Keep candidate `more.evidence` as the only line-level focused evidence path.
- Fail closed on unknown, malformed, or inconsistent group follow-up payloads.

## Acceptance Criteria

- Echoing a valid `more.groupCandidates` payload returns bounded leads only for that group.
- Candidate `more.evidence` behavior remains compatible and focused by canonical path.
- Broad evidence and group expansion remain bounded by default.
- Malformed group follow-up errors include a stable code, invalid field, and corrected server-prepared shape.
- The default response, group follow-up response, and focused evidence response form a pinned three-step agent task fixture.

## Verification

- Run focused search/tool tests.
- Run MCP smoke tests for default, group follow-up, and focused evidence.
- Run `npm run check`.
