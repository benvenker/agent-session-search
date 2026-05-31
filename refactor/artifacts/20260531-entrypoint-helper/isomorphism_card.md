## Change: Extract shared ESM entrypoint predicate

### Equivalence contract

- **Inputs covered:** `src/cli.ts`, `src/server.ts`, and `src/fff-preflight.ts` call `isEntrypoint(import.meta.url, process.argv[1])`.
- **Ordering preserved:** Yes. The predicate is still evaluated before each module's `main().catch(...)` block is installed.
- **Tie-breaking:** N/A.
- **Error semantics:** Unchanged. The helper still calls `realpathSync(fileURLToPath(moduleUrl))` and `realpathSync(argvPath)`, so filesystem errors propagate exactly as before.
- **Laziness:** Unchanged. The predicate is evaluated only at the existing entrypoint guard sites.
- **Short-circuit eval:** Unchanged. Missing `argvPath` still returns `false` before any realpath calls.
- **Floating-point:** N/A.
- **RNG / hash order:** N/A.
- **Observable side-effects:** Unchanged. The only filesystem reads are the same `realpathSync` calls, in the same order, at the same callsites.
- **Type narrowing:** Unchanged. `argvPath` remains narrowed by the `if (!argvPath)` guard before `realpathSync(argvPath)`.
- **Rerender behavior:** N/A.

### Verification

- [x] Baseline `npm run check`: passed before edit.
- [x] Baseline `npm test`: 14 files / 99 tests passed before edit.
- [x] `npm run check` after edit: passed.
- [x] `npm test` after edit: 14 files / 99 tests passed.
- [x] LOC delta recorded: TypeScript total 9,721 -> 9,706 (-15); `src/` 3,671 -> 3,656 (-15).

### Opportunity score

- Candidate: 3 identical `isEntrypoint` helpers -> one shared helper.
- LOC_saved: 2 (5-20 lines expected)
- Confidence: 5 (exact clone at three callsites)
- Risk: 1 (pure helper, same module-local invocation shape)
- Score: 10.0
