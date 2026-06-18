# U2 Gated FFF multi_grep Backend Support

## Objective

Use FFF `multi_grep` for literal OR discovery only when the local implementation proves recall-equivalent to the existing sequential `grep` union.

## Source Plan

Follow `/data/projects/agent-session-search/docs/plans/2026-06-18-001-feat-fff-native-progressive-evidence-plan.md`, especially U2 and requirements R1, R2, R3, R10, R12, R15, and R16.

## Scope

- Update `src/fff-backend.ts`, `src/client-pool.ts`, `test/fff-backend.test.ts`, and `test/client-pool.test.ts` as needed.
- Extend the FFF client abstraction with optional `multiGrep` and capability detection.
- Keep sequential `grep` union as the authoritative safe default.
- Promote `multi_grep` only after a recall-equivalence probe passes.
- Fall back cleanly when `multi_grep` is absent, errors as unknown tool, times out, or fails the equivalence probe.
- Normalize `multi_grep` output through fixture-backed parsing and infer matched literal patterns from returned line content.
- Do not route line-context evidence through `multi_grep` unless parser fixtures explicitly prove support for context separators, read suggestions, and summaries.

## Acceptance Criteria

- Eligible multi-pattern discovery calls `multi_grep` once with literal patterns and appropriate discovery budget.
- Ineligible or failing `multi_grep` uses the existing sequential union without losing source/root/path metadata.
- Backend metadata and structured warnings explain the fallback and recommended action without failing an otherwise usable search.
- A physical line matching multiple literal patterns records all matched patterns but counts as one hit.
- Include/path filters, timeouts, warmup retry behavior, and non-fatal source warnings keep existing semantics.

## Verification

- Run focused backend/client-pool tests.
- Run live FFF smoke where available, skipped when `fff-mcp` is unavailable.
- Run `npm run check`.
