# U3 Grouped Candidate Output

## Objective

Shape default candidate results as compact candidate groups ordered by the static match-group contract.

## Source Plan

Follow `/data/projects/agent-session-search/docs/plans/2026-06-18-001-feat-fff-native-progressive-evidence-plan.md`, especially U3 and requirements R4, R5, R6, R7, R10, R11, R12, R15, and R17.

## Scope

- Update `src/search.ts`, `test/search.test.ts`, and `test/mcp-smoke.test.ts` as needed.
- Carry structured pattern-plan metadata through search coordination.
- Build grouped output over the current backend result contract first, so behavior works on sequential `grep` union even if `multi_grep` is not promoted.
- Canonicalize candidates by source and path, attach all group memberships, and place each lead under its strongest group only.
- Sort groups by the public static priority contract and sort candidates within a group using existing candidate ordering signals.
- Keep normal output free of public numeric relevance scores; debug may expose group assignment and tie-break inputs.

## Acceptance Criteria

- Default candidate mode returns `resultsShape: "candidate_groups"` and ordered non-empty groups.
- Empty groups are omitted and no-hit searches return an empty grouped result.
- Candidates matching multiple groups appear once under the strongest group and retain membership metadata.
- Higher-priority groups appear before lower-priority groups even when lower groups have more hits.
- Counts distinguish assigned candidates, displayed leads, and physical matched lines with explicit exact/lower-bound relation semantics.
- Top-level metadata names shape, backend mode, limits, count semantics, and fallback reason where applicable.

## Verification

- Run focused search and MCP smoke tests.
- Run `npm run check`.
