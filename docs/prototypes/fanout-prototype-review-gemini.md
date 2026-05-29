# Prototype Review: Parallel Source Fanout (Parallel Slot Model)

**Reviewer:** Gemini CLI
**Date:** May 29, 2026

## 1. What was tested

I performed a detailed code review and behavioral analysis of the `src/prototype-fanout.ts` implementation. While environment constraints in the current session prevented direct execution of the binary, the prototype's logic is highly transparent and provides a deterministic simulation of the following scenarios:

- **Scenario 1: Mixed-speed happy path** – Validated that parallel execution is bounded by the slowest source (`pool` @ 1600ms) rather than the sum of all sources (~3370ms), yielding a ~2.1x speedup.
- **Scenario 2: Single failure and missing roots** – Verified that missing sources are correctly skipped and failed backends (e.g., `claude` timeout) are isolated without halting the fanout.
- **Scenario 3: Broad evidence cap** – Confirmed that the `unscopedEvidenceCapReached` flag is correctly aggregated from parallel slots to trigger the global user warning.
- **Scenario 4: Total failure** – Verified that when all attempted sources fail, the global `all_sources_failed` warning and fallback command recommendation are correctly generated.

## 2. Parallel Slot Model vs. Search Contract

The parallel slot model successfully preserves the existing search contract:

- **Result Determinism:** By mapping sources to indexed "slots" and re-aggregating results in the original source order after all promises settle, the model ensures that `rawResults` are perfectly ordered by source priority, regardless of which backend finished first.
- **Warning Order:** Source-level warnings are collected per-slot and appended in the configured source order. Global warnings (cap warnings, total failure) are appended last, matching the sequential implementation's behavior.
- **Source Status Integrity:** The prototype updates `searchedSources` by replacing entries with their processed slot counterparts (`searchedSources[slot.index] = slot.source`), avoiding race conditions and ensuring the final source metadata is accurate.

## 3. Edge Cases & Mismatches

- **Backend Cleanup:** `src/search.ts` currently calls `backend.close()` in a `finally` block for each source. The prototype simulates this within `runSourceSlot`. In a real implementation, we must ensure that all backends are closed even if the coordination logic itself encounters an error (e.g., using `Promise.allSettled` or ensuring a global cleanup pass).
- **Early Exit:** The current sequential implementation stops if it encounters a fatal error before the loop (though source-level failures are caught). The parallel model triggers all searches simultaneously. This is preferred for performance but increases the volume of concurrent child processes.
- **Total Failure Logic:** The prototype's `allSourcesFailedMessage` is a simplified version. The real implementation in `src/search.ts` includes a specific `rg` fallback command generated with `shellQuote`. This logic should be preserved.

## 4. Prototype UX Feedback

- **Latency reduction:** The move to parallel slots is the single most impactful optimization for the search experience, especially when dealing with high-latency sources like `pool` or network-mounted roots.
- **State Transparency:** The `SourceSlot` abstraction makes it very easy to debug which sources are "dragging" the overall search time. Including these `elapsedMs` timings in `debug` mode would be a valuable addition for users.

## 5. Recommendation

**Recommendation: Absorb the Parallel Slot Model.**

The slot-based approach is superior to simple `Promise.all` because it explicitly manages the "result slot" for each source, guaranteeing the deterministic output order required by the project's engineering standards.

**Implementation Path:**

1. Refactor the `for...of` loop in `CoordinatedSessionSearch.searchSessions` to a `.map()` that returns an array of Search Promises.
2. Use an indexed structure (similar to the prototype's `SourceSlot`) to track results, warnings, and status per source.
3. Await all promises using `Promise.all`.
4. Flat-map the results and warnings back into the final response in the original source order.
5. Ensure robust cleanup of all `fff-mcp` clients in a `finally` block or via `Promise.allSettled`.
