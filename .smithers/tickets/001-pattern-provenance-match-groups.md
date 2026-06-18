# U1 Pattern Provenance And Match Group Contract

## Objective

Add the internal vocabulary and type surface for static match groups, candidate groups, counts, group memberships, warnings, teaching errors, and group follow-up payloads.

## Source Plan

Follow `/data/projects/agent-session-search/docs/plans/2026-06-18-001-feat-fff-native-progressive-evidence-plan.md`, especially U1 and requirements R4, R5, R6, R7, R8, R11, R12, R15, R16, and R17.

## Scope

- Update `src/types.ts`, `src/tool.ts`, `src/query-rewriter.ts`, `test/query-rewriter.test.ts`, and `test/tool.test.ts` as needed.
- Add a structured pattern-plan path with literal pattern, provenance, stable pattern id, and initial static match group.
- Preserve `rewriteQueryPatterns()` as a compatibility wrapper returning strings.
- Keep pattern planning deterministic and derived only from caller input/configuration before inspecting results.
- Do not introduce LLM-generated synonyms, semantic expansion, query-specific boosts, or hardcoded sample query terms.
- Define shared response types for match groups, candidate groups, per-count relation structures, group memberships, recommended actions, structured warning codes, and server-prepared group follow-up payloads.

## Acceptance Criteria

- Bare multi-word queries produce structured pattern plans with phrase/adjacent/natural-term fallbacks assigned to generic static groups.
- Structured fragments such as quoted text, paths, IDs, packages, and error fragments receive stronger provenance than loose natural terms.
- Existing string-array query rewriting callers keep working.
- Invalid group follow-up inputs fail as user-input errors and include the invalid field, stable code, and corrected payload shape.
- Tests prove group assignment is based on extractor origin and coverage, not specific example words.

## Verification

- Run focused query-rewriter and tool schema tests.
- Run `npm run check`.
