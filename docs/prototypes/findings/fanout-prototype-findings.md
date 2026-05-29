# Fanout Prototype Findings

Date: 2026-05-29

## Question

Can `searchSessions` move from sequential per-source search to parallel per-source slots while preserving deterministic output order, warning behavior, failure accounting, and evidence-cap behavior?

## How We Tested

I ran the throwaway prototype in `src/prototype-fanout.ts` directly and then used NTM to ask Claude and Gemini for structured review. Their useful review signals are summarized in this findings document; the raw review artifacts were treated as scratch input rather than durable repo history.

Prototype command, from the package script in `package.json`:

```bash
npm run prototype:fanout
```

Scenarios exercised:

| Scenario                   |   Sequential | Parallel Slots | Speedup | Result Order | Warning Order                  |
| -------------------------- | -----------: | -------------: | ------: | ------------ | ------------------------------ |
| Mixed-speed happy path     |      3388 ms |   1603-1604 ms |   2.11x | Preserved    | Preserved                      |
| Failure plus missing root  | 1759-1760 ms |         901 ms |   1.95x | Preserved    | Preserved for modeled warnings |
| Broad evidence cap         | 1558-1559 ms |     752-753 ms |   2.07x | Preserved    | Preserved                      |
| All attempted sources fail | 1106-1107 ms |         702 ms |   1.58x | Preserved    | Preserved                      |

## Verdict

Adopt the parallel-slot implementation shape. The prototype answers the core coordination question: aggregate per-source work by source index after all slots settle, rather than pushing into shared arrays as each source completes. That gives the expected latency win while preserving the ordering assumptions used later by candidate and evidence grouping.

The right production shape is:

1. Build one slot promise per searchable source.
2. Catch all source-local failures inside the slot so `Promise.all` does not reject early.
3. Return a slot object containing source status, warnings, results, cap flags, attempted/failed counts, and original index.
4. Merge slots in original source order.
5. Append global warnings only after all slots settle.

The PRD should treat this as a search coordination change, not a new search backend. FFF remains the engine, `search_sessions` remains the public MCP surface, and result shaping should stay close to the current FFF result shape.

## What The Prototype Gets Right

- It avoids concurrent mutation of shared `searchedSources`, `warnings`, and `rawResults`.
- It merges by source index, so fast sources do not jump ahead of slow sources.
- It keeps `attemptedSourceCount`, `failedSourceCount`, and `unscopedEvidenceCapReached` as post-slot reductions.
- It computes `broad_evidence_capped` and `all_sources_failed` after all source work finishes.
- It makes the latency tradeoff visible: wall-clock becomes roughly the slowest source, not the sum of all sources.

## Evidence Checked

- `src/search.ts` currently performs source work sequentially inside `CoordinatedSessionSearch.searchSessions`, seeds warnings from resolved root warnings, applies backend warnings and failure accounting inside the loop, appends global warnings after the loop, then filters and shapes results.
- `src/search.ts` keeps two cap values: `maxResultsPerSource` and `requestMaxResultsPerSource`. They diverge when `input.paths` is present, so the production slot model must carry the existing cap semantics instead of copying the prototype's single-cap simplification.
- `src/client-pool.ts` memoizes FFF clients by root and centralizes pool shutdown through `createFffBackendPool.close()`. The default pooled backend wrapper exposes search behavior without transferring client ownership to each source slot.
- `test/search.test.ts` already has public-API coverage for missing roots, partial backend failure, backend error warnings without hits, default unscoped evidence caps, explicit caps, include filtering, and path-restricted evidence. New tests should extend those contracts rather than testing private helpers.

## PRD-Ready Implementation Modules

Use these module boundaries in the PRD. They are behavior boundaries, not a request to create one file per bullet.

- Source slot runner: searches one resolved source, catches source-local failures, returns a complete slot result, and never mutates shared aggregate arrays.
- Fanout coordinator: starts source slots, waits for all attempted sources to settle, and preserves the configured source order during merge.
- Deterministic merge: combines searched source status, warnings, raw results, failure counts, and cap flags by original source index.
- Warning derivation: keeps root-resolution warnings first, source warnings second in source order, and global warnings last.
- Evidence cap handling: preserves the existing distinction between unscoped evidence caps and path-restricted focused evidence.
- Backend lifecycle: keeps default pooled FFF teardown centralized, while handling custom backends that expose per-search cleanup.
- Debug observability: optional per-source elapsed timings may be useful, but should not change normal response shape unless explicitly designed.

## Gaps To Fix Before Production

1. Preserve `resolvedRoots.warnings` first.
   The prototype does not seed global warnings from root resolution, so the missing-root warning path is under-modeled. Production should keep root-resolution warnings first, then merge source warnings in source order, then append global warnings.

2. Keep `maxResultsPerSource` and `requestMaxResultsPerSource` distinct.
   The prototype collapses them into one field. In production they diverge for path-restricted evidence requests, so the slot result needs both values available where relevant.

3. Add a path-restricted evidence regression case.
   The prototype does not exercise `input.paths`, include filtering, focused evidence cap behavior, or final `filteredResults` handling.

4. Decide whether to bound concurrency.
   Unbounded `Promise.all` over the default six sources is probably fine, but it changes peak IO, memory, and process pressure. If we want a conservative first cut, use a small internal concurrency limit or a named constant.

5. Keep backend lifecycle centralized.
   Claude confirmed the current default pool returns a backend wrapper without per-slot `close`, so pool teardown remains centralized. The implementation should preserve this assumption and be careful with custom `createBackend` implementations that do return `close`.

## Testing Contract

Test through the public `searchSessions` behavior. Avoid tests that assert private function names, promise timing internals, or the exact shape of a slot object unless that object becomes a deliberate public module interface.

Recommended production tests:

- Multi-source fake backend with intentionally staggered delays, asserting candidate output order remains source order.
- Partial failure with one missing root and one backend warning, asserting warning order is root warnings, then source warnings, then global warnings.
- All attempted sources fail, asserting `all_sources_failed` still appears only when every attempted searchable source failed and no raw results exist.
- Broad unscoped evidence cap, asserting cap warnings are still emitted once after slot merge.
- Path-restricted evidence with explicit `maxResultsPerSource`, asserting focused evidence cap behavior is unchanged.
- Custom backend cleanup case, asserting any per-backend `close` hooks still run without closing shared default pool clients early.

## Out of Scope

- Replacing FFF, adding embeddings, adding SQLite indexing, or exporting markdown sessions.
- Changing the public MCP surface beyond the existing `search_sessions` behavior.
- Re-ranking, summarizing, or otherwise changing response semantics outside deterministic source fanout.
- Splitting Pool into multiple built-in sources.
- Keeping the throwaway prototype as product code after the production behavior lands.

## Prototype UX Notes

The comparison table is useful and should stay if the prototype lives for another pass. The full JSON state dump is valuable but noisy; default output would be easier to use if the dump were behind the existing `last` command. The current smoke-by-pipe behavior runs the first scenario cleanly; running scenarios individually gives cleaner output.

## NTM Notes

Claude's NTM review was the most useful external signal. Gemini's review independently agreed with the slot model and suggested surfacing per-source elapsed timings in debug mode, but it did not directly execute the prototype. Both review signals are captured above; the raw review files are not retained as durable artifacts.
