# Fanout Prototype Review

Reviewer: Claude (Opus 4.8)
Date: 2026-05-29
Subject: `src/prototype-fanout.ts` — parallel per-source slot orchestration sketch
Scope: throwaway prototype review. No production source was modified.

## 1. What I tested

I read `AGENTS.md`, `DESIGN.md`, `src/search.ts`, `src/prototype-fanout.ts`, and
`src/prototype-fanout.NOTES.md`, then cross-referenced the backend wiring in
`src/client-pool.ts` and `src/fff-backend.ts` to judge concurrency safety the
prototype itself can't exercise.

I ran `npm run prototype:fanout` and drove all four built-in scenarios. Each run
executes the same source set twice — once sequentially, once with parallel slots
— and compares wall-clock, accounting, and ordering.

Observed results:

| #   | Scenario                       | Sequential | Parallel | Speedup | ≈ slowest source        | Result order preserved | Warning order preserved |
| --- | ------------------------------ | ---------: | -------: | ------: | ----------------------- | :--------------------: | :---------------------: |
| 1   | mixed-speed happy path         |    3388 ms |  1603 ms |   2.11x | pool (1600 ms)          |          yes           |           yes           |
| 2   | one failure + one missing root |    1760 ms |   901 ms |   1.95x | claude timeout (900 ms) |          yes           |           yes           |
| 3   | broad evidence cap warning     |    1558 ms |   752 ms |   2.07x | pool (750 ms)           |          yes           |           yes           |
| 4   | all attempted sources fail     |    1106 ms |   702 ms |   1.58x | claude (700 ms)         |          yes           |           yes           |

In every scenario the parallel wall-clock collapses to roughly the slowest single
source, and the `rawResults` signature, `searchedSources` statuses, failure
counts, cap flag, and warning code sequence are byte-identical between the two
modes. The core question in the NOTES file — _can per-source slots preserve
deterministic output while cutting wall-clock time?_ — answers **yes** for the
state the prototype models.

## 2. Does the parallel slot model preserve the current search contract?

For the slice of `searchSessions` it models, yes — and the prototype gets the
non-obvious parts right.

- **Result order.** `Promise.all` preserves input array order regardless of
  settle time, and the prototype collects `rawResults` by iterating the
  index-ordered `slots` array, not by completion order. So a fast source that
  finishes first does not jump ahead of a slow source listed before it. This is
  the property `toCandidates`/`toEvidenceGroups` in `search.ts:258-333` depend on
  — they dedupe via `Map` insertion order, so first-occurrence-wins only holds if
  `rawResults` order is stable. The prototype proves that invariant holds.
- **`searchedSources` mutation safety.** This is the real trap, and the prototype
  handles it correctly. The production loop (`search.ts:109-176`) mutates the
  `source` object **in place** (`source.status = "failed"`, `source.warning = …`).
  That is fine sequentially but unsafe if you naively share those objects across
  concurrent slots. The prototype instead clones per slot (`slotSource = {...source}`,
  line 305) and writes the result back by index after settle
  (`searchedSources[slot.index] = slot.source`, line 275). That is the pattern the
  real implementation must adopt: **stop mutating the shared source object inside
  the slot; return a new status and merge it back deterministically.**
- **Failure accounting.** `attemptedSourceCount`, `failedSourceCount`, and
  `unscopedEvidenceCapReached` are reduced over settled slots with `+=` and `||=`.
  Sum and logical-OR are order-independent, so the aggregate is identical to the
  sequential running total. Scenarios 2 and 4 confirm counts match.
- **Global warnings derived after settle.** `broad_evidence_capped` and
  `all_sources_failed` are computed in `addGlobalWarnings` only after all slots
  resolve, mirroring the post-loop blocks at `search.ts:178-194`. Order is
  preserved: per-source warnings first (in source order), then the global
  warnings appended. Scenario 4 shows the exact production sequence
  `source_search_failed, fff_backend_error, all_sources_failed`.

I also confirmed the real backend lifecycle is already parallel-compatible, which
the prototype does not model but matters for the verdict: `createFffBackendPool`
keys clients by `root` (`client-pool.ts:61-75`), so distinct sources get distinct
fff-mcp child processes — parallel `grep` calls hit independent clients, not a
shared multiplexed pipe. And the backend handed back wraps the pooled client as a
`{ grep }`-only object with no `close` (`client-pool.ts:40-42`), so the per-source
`finally { await backend?.close?.() }` in `search.ts:173-175` is a no-op; teardown
is centralized in `pool.close()`. Running slots in parallel therefore won't close a
client another slot is still using.

## 3. Edge cases and mismatches with `src/search.ts`

The prototype is a faithful sketch of the _aggregation_ logic but elides several
real behaviors. None of these break the parallelism conclusion, but they should be
on the implementer's checklist because "the prototype passed" does not cover them:

1. **Two distinct cap variables collapsed into one.** Production tracks both
   `maxResultsPerSource` and `requestMaxResultsPerSource`
   (`search.ts:80-88`), and they diverge in the path-restricted case
   (`input.paths?.length`). Critically, the cap _applied_ to results is
   `requestMaxResultsPerSource` (line 131) while the flag that drives
   `broad_evidence_capped` is checked against `maxResultsPerSource` (lines
   146-150). The prototype has a single `scenario.maxResultsPerSource`, so this
   split — and the path-restricted branch where they differ — is never exercised.
2. **Resolution warnings are not seeded.** Production starts
   `warnings = [...resolvedRoots.warnings]` (`search.ts:101`), so missing/unreadable
   roots produce warnings _before_ any source warning. The prototype starts
   `warnings` empty. In Scenario 2 the `pi` source is `missing` with
   `warning: "missing root"`, yet the global `warnings` array contains only
   `fff_backend_timeout` — the missing-root warning is silently dropped. So the
   "warning order preserved" claim is only proven over the loop-generated subset,
   **not** over the leading resolution warnings. The real implementation must keep
   `resolvedRoots.warnings` prepended ahead of the (now unordered-arrival) source
   warnings, and re-sort source warnings back into config order after settle.
3. **Per-result transforms not modeled.** `resultMatchesSourceFilters` (include
   globs + path filter), `truncateEvidenceResult`, and the `queryByPattern`
   attachment (`search.ts:131-145`) are all skipped. These are per-result, per-source,
   and order-independent, so they parallelize trivially — but the prototype doesn't
   demonstrate that, it just omits them.
4. **`shapeResults` / `toCandidates` not exercised.** The prototype stops at
   `rawResults`. The actual contract output (candidates, evidence groups, evidence
   hits) is produced downstream. Since it depends only on stable `rawResults` order
   (which is proven), this is a safe omission — worth stating explicitly so nobody
   assumes the response shaping was validated.
5. **No concurrency cap / backpressure.** The prototype fires every source via one
   unbounded `Promise.all`. Production has six built-in roots, each spawning an
   fff-mcp child. Six simultaneous subprocesses is probably fine, but it is a real
   resource-profile change from sequential (peak memory, file descriptors, CPU
   contention during indexing) that the in-memory `sleep()` model cannot reveal.
6. **Shared-root aliasing.** The pool memoizes one client per `root`. If config
   ever maps two source names to the same root (or duplicates a root), parallel
   slots would issue concurrent `grep` on a _shared_ client. MCP stdio clients are
   generally id-correlated and concurrency-tolerant, but this path is untested and
   the current built-ins happen to have distinct roots, so the hazard is latent.
7. **Slot errors must never reject.** The prototype's `runSourceSlot` catches
   everything internally and always resolves, so `Promise.all` never rejects. The
   real implementation must preserve that contract — in particular `createBackend`
   throwing (e.g., fff-mcp spawn failure) must be caught _inside_ the per-slot
   wrapper, exactly as the try block at `search.ts:116-117` already does.

## 4. Prototype UX feedback

- The side-by-side sequential-vs-parallel table with an explicit `speedup` column
  and the two boolean "order preserved" lines is genuinely good — it makes the
  thesis falsifiable at a glance rather than burying it in the state dump.
- The full-state JSON dump after every run is large and floods the terminal; with
  piped input it pushes the comparison table out of a default scrollback. Consider
  gating the dump behind the existing `last` command only, and printing just the
  comparison + the two verdicts by default.
- The determinism check is mildly **circular**: both modes call the same
  `runSourceSlot`, so the only moving part is aggregation. That's the right thing
  to isolate, but the headline "Deterministic result order preserved: true" reads
  stronger than it is — it proves _aggregation_ is order-stable, not that the
  backend returns deterministic hits. Worth a one-line caveat in the output.
- The DEP0205 `module.register()` deprecation warning from tsx prints mid-prompt
  and looks alarming; harmless, but noise.
- Minor: the menu says "Choose 1-4" on bad input but the prompt loop is otherwise
  undiscoverable for `last`/`m`. Fine for a throwaway.
- Scenario coverage is well-chosen: happy path, partial failure + missing root,
  cap warning, and total failure cover the four global-warning branches. The one
  gap is a **path-restricted / `evidence` mode** scenario, which is exactly where
  the two cap variables (mismatch #1) diverge.

## 5. Recommendation for the real implementation

**Adopt the parallel-slot shape, with conditions.** The prototype validates the
load-bearing claim: fanning out per source and aggregating after settle preserves
result order, warning order (within the loop-generated set), failure accounting,
and cap behavior, while cutting wall-clock from sum-of-sources to
≈slowest-source (~2x on a typical mixed-speed mix, and the real win scales with
source count). The backend wiring is already parallel-safe (per-root clients,
no-op per-slot close, centralized pool teardown), so this is a contained change to
the loop in `search.ts:109-194`, not an architecture rework.

Conditions before landing:

1. **Stop mutating the shared `source` object inside the slot.** Refactor the loop
   body into a pure `runSourceSlot(source, index) -> SourceSlot` that operates on a
   clone and returns status/warnings/results, then merge back by index — exactly as
   the prototype does. This is the single most important correctness change.
2. **Preserve full warning order**, including `resolvedRoots.warnings` first, then
   source warnings re-sorted into config/index order (arrival order is now
   nondeterministic), then global warnings. Add a test asserting a missing-root
   warning precedes a backend warning — the gap the prototype hid in Scenario 2.
3. **Carry both cap variables through.** Keep `maxResultsPerSource` vs
   `requestMaxResultsPerSource` distinct per slot and add a path-restricted +
   `evidence`-mode test, since that's where they diverge and the prototype is silent.
4. **Bound concurrency** with a small worker pool (or at least make the cap a named
   constant) rather than an unbounded `Promise.all`, and verify peak fff-mcp
   subprocess count against real roots before shipping.
5. **Keep the determinism assertion as a real test**, not just a prototype print:
   run a fixed fake-backend set through both a sequential reference and the parallel
   path and assert identical `rawResults`/`warnings`/`searchedSources`.

Treat the prototype as answered and absorbable: lift the slot/merge pattern into
`search.ts`, then delete `src/prototype-fanout.ts` and its NOTES per the file's own
"delete or absorb after use" header. Track the conditions above as Beads items per
`AGENTS.md`/`DESIGN.md` guidance rather than reviving a PRD.
