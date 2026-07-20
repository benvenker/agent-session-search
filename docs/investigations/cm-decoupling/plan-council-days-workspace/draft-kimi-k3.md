# Plan Council Draft — `days` / `workspace` deterministic filters (kimi-k3)

Author: kimi-k3
Source concept: `docs/plans/2026-07-20-001-feat-days-workspace-filters-plan.md` (status: implementation-ready)
Companion: `docs/plans/2026-07-20-001-feat-cass-compat-shim-plan.md` (consumes these fields in-process; ships after this one)

Note: the council task framed this as "FFF two-lane architecture"; the resolved concept input is the days/workspace filters plan, and this draft plans that concept. The two-lane (managed vs native) boundary is treated as a constraint, not the subject.

## Concept intent

Add two deterministic, non-ranking filters — `days` (file-mtime cutoff) and `workspace` (three-lane workspace match) — to `search_sessions` with exact CLI↔MCP field parity, so the companion cass-compat shim can satisfy cm's `--days` / `--workspace` search calls against this repo's grep-based engine. Filters are drops, never ranking signals, and must survive `groupCandidates` followup replay without breaking existing filter-less fingerprints.

## Recommended implementation shape

Single vertical slice through the existing managed lane, in this dependency order:

1. **Contract first** (`src/types.ts`): extend `SearchSessionsInput`, `GroupCandidatesFollowupInput`, `SearchSessionsMetadata.filters`, and the `SearchWarningCode` union with `"filters_removed_all_results"`. Types land first so every downstream surface compiles against the final shape.
2. **Core filter module, kept private to `src/search.ts`**: a small set of pure helpers plus one async applier, wired into the existing pre-cap attach point in `searchSourceSlot` (verified at `src/search.ts:358-364` — canonicalization is already awaited before `resultMatchesSourceFilters` and `maybeCapResults`).
3. **MCP surface** (`src/tool.ts`): zod fields + strict followup schema + mismatch/correctedShape handling.
4. **CLI surface** (`src/cli.ts`, `src/help.ts`): flags, typo correction, mapping, help/capabilities/robot docs.
5. **Tests, then docs** (`docs/cli.md`, `docs/mcp.md`, `DESIGN.md` inlined input type).

Concur with the concept's five key decisions, with one refinement and one explicit tradeoff preserved below.

### Filter semantics (converged)

- **`days`**: `cutoff = now() − days·DAY_MS` computed **once per `searchSessions` call** and passed down as a plain number through `SourceSearchSlotInput` — not a function, not re-derived per slot. Injectable `now?: () => number` on `CreateSessionSearchOptions` (`src/search.ts:1784`) only for tests. Drop unstatable files when `days` is set ("provably modified within N days"); keep them when it is not.
- **`workspace`**: canonicalized once per search (`~`-expand → absolute resolve → realpath with fallback to the non-realpathed resolve, following the existing pattern near `src/search.ts:1292-1302`). Three deterministic lanes, evaluated per candidate in cheap-to-expensive order:
  1. containment: `pathIsWithin(candidatePath, W)`
  2. dash-encoded segment equality: encode W (`replace(/[^a-zA-Z0-9]/g, "-")`), compare against each path segment with leading-dash guard, **exact equality only** — never decode dir names (dash encoding is lossy; verified sibling collision in the concept), never prefix-match (precision over rare worktree misses). Matcher must be source-agnostic so both omp formats (`--…--` and bare) and claude-style dirs are covered.
  3. session-metadata lane: reuse `projectSignalsFromCandidateMetadata` (`src/search.ts:1140-1177`) with its parameter loosened from `SearchCandidate` to `{source, path}` so it works on `SearchResult` pre-grouping; match iff any extracted metadata path satisfies `pathIsWithin(metaPath, W)`. Without this lane codex/pool never match.
- **No token heuristics anywhere in the filter path.** Tokens are ranking-only; filter verdicts must be explainable as containment/encoding/metadata.
- **Apply point**: per source slot, after canonicalization and `resultMatchesSourceFilters`, before `maybeCapResults` — so stale/off-workspace files never consume caps. Track `filterRemovedCount` on `SourceSearchSlotResult`; emit one `filters_removed_all_results` warning with `recommendedAction` only when filters were active, final results are empty, and removed > 0.
- **Echo**: `metadata.filters = {days?, workspace?}` with workspace echoed **canonicalized**; `stableJson` (`src/followup.ts:67-83`) already skips undefined keys, so filter-less followup payloads stay byte-identical. New fields must be mirrored through every groupCandidates surface: `effectiveSearchInput` (`:1660`), `groupFollowup` (`:853-894`), strict zod schema, `normalizeGroupCandidatesShorthand`, `correctedShape`, and the mismatch validator modeled on `maxResultsPerSource` (`src/tool.ts:318-326`).

### Tradeoffs and disagreements preserved

- **Async metadata lane vs sync filter**: `resultMatchesSourceFilters` is currently sync; the metadata lane makes the combined predicate async. Options: (a) keep the existing sync source-filter pass, then run a separate async `applySessionFileFilters` with a memoized `Map<path, Promise<boolean>>` so repeat hits on the same file cost one stat/read — **recommended**, minimal intrusion; (b) fold everything into one async predicate — rejected, it forces the source-filter call site to change shape for no gain.
- **Lane order**: containment → encoded segment → mtime → metadata. The concept lists mtime before metadata; I keep mtime (one `stat`) strictly before the metadata lane (up to `SESSION_METADATA_MAX_BYTES` read + JSONL parse) and make the metadata lane run only when lanes 1–2 fail and `workspace` is set. `days` alone never triggers file reads.
- **Nonexistent workspace is not an error**: empty results + warning, exit 0, mirroring the missing-root policy. A stricter fail-fast was considered and rejected — the shim must not turn cm typos into hard failures.
- **`days` granularity**: integer-only (`z.number().int().positive()`, `parsePositiveInteger`). Fractional days are a shim-side concern; keep the contract tight.

## Ordered implementation steps

1. `src/types.ts` — add `days?: number; workspace?: string` to `SearchSessionsInput` (:11-24) and `GroupCandidatesFollowupInput` (:82-102); add `filters?: {days?: number; workspace?: string}` to `SearchSessionsMetadata` (:179-196); add `"filters_removed_all_results"` to the warning union (:121-130).
2. `src/search.ts` — add helpers near the ranking privates: `prepareSessionFileFilters`, `canonicalWorkspacePath`, `encodeWorkspaceDirName`, `stripDashes`, `workspaceEncodedSegmentMatch`, `resultPassesSessionFileFilters`, `applySessionFileFilters` (memoized per-search `Map<path, Promise<boolean>>`). Compute prepared filters once in `searchSessions` (~:97-113); extend `SourceSearchSlotInput`/`Result` (:273-297) with `sessionFileFilters`/`filterRemovedCount`; apply between :360 and :361; loosen `projectSignalsFromCandidateMetadata` to accept `{source, path}`; add `now?` to `CreateSessionSearchOptions` (:1784-1794); emit the warning in the aggregation path (~:186-207); extend `searchMetadata` (:1689-1729); spread the fields in `effectiveSearchInput` (:1660-1687) and `groupFollowup` (:853-894).
3. `src/tool.ts` — zod: `days: z.number().int().positive().optional()`, `workspace: z.string().min(1).optional()` in `searchSessionsInputSchema` (:60-163) **and** strict `groupCandidatesFollowupSchema` (:31-58); mismatch checks in `validateGroupCandidatesFollowup` (:258-357); carry in `normalizeGroupCandidatesShorthand` (:359-428) and `correctedShape` (:179-206).
4. `src/cli.ts` — `ParsedArgs` (:29-49); `KNOWN_OPTIONS` (:67-90) + typo corrections (`--dsys`, `--workspce`, d=1); parse branches (`--days` via `parsePositiveInteger` :709-718 → `--days 0` is a parse error, exit 1; `--workspace` string via the `--cwd` pattern :146-153); `groupCandidatesMixedFlags` (:392-432) rejects mixing; map in `searchInputFromParsedArgs` (:546-565).
5. `src/help.ts` — `cliHelpText` usage/options/example; `cliCapabilities` usage strings + `contract.warnings` entry (:171-186); `robotDocsGuide` one line (deterministic drops, survive replay); `robotTriage` one recommended command; `mcpSearchSessionsDescription` one sentence.
6. Tests (see below).
7. Docs — `docs/cli.md` flag table (:20-46) + lanes/lossiness/drop-rule paragraph; `docs/mcp.md` input table (:73-83) + replay + warning note; `DESIGN.md` inlined input type (:85-97) + one deterministic-filters paragraph near :106.

Land steps 1–2 (+ core search tests) as one commit and 3–5 (+ surface tests) as a second, or all as one — but never 3–5 without 1–2, since the surfaces are dead wiring without the core.

## Files/modules likely to change

- `src/types.ts` — input/followup/metadata/warning types
- `src/search.ts` — filter helpers, slot wiring, warning, metadata echo, followup spread, `now` injection
- `src/tool.ts` — zod schemas, followup validation, shorthand/correctedShape
- `src/cli.ts` — flags, parsing, typo suggestions, group-mix rejection, input mapping
- `src/help.ts` — help/capabilities/robot-docs/robot-triage/MCP description
- `test/search.test.ts`, `test/tool.test.ts`, `test/cli.test.ts` — new + updated pinned tests
- `docs/cli.md`, `docs/mcp.md`, `DESIGN.md` — contract documentation
- Possibly `test/mcp-smoke.*` if description strings are pinned

Explicitly out of scope: `src/followup.ts` (stableJson already skips undefined — verify, don't modify), ranking code, `more.evidence`, config defaults, new subcommands, native-lane policy.

## Tests and validation

Unit/integration:

- `test/search.test.ts` via the `createBackend` seam (pattern at :2716) with tmp files + `utimes`:
  1. 90-day-old file dropped at `days:30` in evidence and candidates modes; control run without `days` keeps it
  2. unstatable path dropped when `days` set, kept when unset
  3. claude-style and omp-style (both formats) encoded dir match; sibling `-…-extra` does NOT match; leading-dash guard honored
  4. metadata lane: codex-named source with `{"cwd": …}` first line matches/rejects correctly; non-codex jsonl still checked via `mayContainSessionMetadata` rules
  5. containment lane matches nested paths
  6. filter-to-empty → `results: []` + `filters_removed_all_results` warning with `recommendedAction` + `metadata.filters` echo (workspace canonicalized)
  7. followup replay keeps filters; fingerprint remains valid; pinned fingerprint literal for filter-less payload unchanged, changes when `days` added
  8. injected `now` makes cutoff deterministic (no real clock in assertions)
- `test/tool.test.ts` — schema accept/reject (`days: 1.5`, `days: 0`, `workspace: ""` rejected); shorthand carry; mismatch → `SearchSessionsInputError` with correct `invalidField`
- `test/cli.test.ts` — flag mapping (update the exact-`toEqual` tests at :523-545/:563-577/:589-603 in the same commit); `--days 0`/non-numeric errors; `--dsys`/`--workspce` suggestions; group-mix rejection

Commands:

- `npm run check && npm test` green
- Live-corpus proofs:
  - `npm run dev:cli -- "cass" --json --days 2` → every returned path's mtime ≤ 48h (verify with jq+stat)
  - `npm run dev:cli -- "cass" --json --workspace /data/projects/agent-session-search` → only this repo's session dirs across ≥2 sources (claude AND omp dash-dirs), zero foreign paths
  - `--days 3650 --workspace /nonexistent/ws` → `results: []`, warning present, exit 0
  - `--dsys 7` → exit 1, "did you mean --days?", copy-pasteable `suggestedCommand`
  - `capabilities --json` documents both flags; `--robot-triage` shows a filter example
- MCP parity: `npm run dev:mcp`, call `search_sessions` with `{"query":"cass","days":7,"workspace":"/data/projects/agent-session-search","maxResultsPerSource":5}` (exact shim call shape) → same behavior as CLI; `more.groupCandidates` replay round-trips
- Determinism: same filtered CLI query twice → byte-identical JSON

## Risks, constraints, open questions

Risks:

- **Missing a groupCandidates mirror surface** — six places must carry the fields; test 7 (replay round-trip) plus the strict-schema mismatch test are the guards. Highest-probability bug in this plan.
- **Exact-equality CLI mapping tests break** until updated — keep in the same commit as the CLI change.
- **Metadata-lane I/O cost** on large result sets — mitigated by memoization per path, lane ordering (metadata last), and existing `SESSION_METADATA_MAX_BYTES`/`MAX_LINES` bounds; do not add a new budget.
- **Warning noise**: `filters_removed_all_results` must not fire when sources were already empty pre-filter (removed == 0) — pin in test 6 variant.
- **Pinned description strings** in mcp-smoke tests may break on the `mcpSearchSessionsDescription` sentence — check before assuming green.

Constraints:

- Managed one-tool boundary: everything stays inside `search_sessions`; native lane untouched (fail-closed policy in `src/fff-native-policy.ts` not involved).
- Filters are deterministic drops; no ranking coupling; recency ranking untouched.
- canonical absolute paths preserved in output; workspace echo is canonicalized.
- Exit-code contract unchanged: parse errors exit 1 with `user_input_error` JSON envelope; environment failures exit 3.

Open questions that would change implementation order:

- **Does the shim need `days`/`workspace` echoed in `more.evidence` payloads too?** The concept scopes replay to `more.groupCandidates` only. If evidence followups must also carry filters for cm parity, add a mirror there and reorder step 2 before finalizing — currently a non-goal.
- **Should `workspace` accept multiple paths?** cm sends one; the plan implements one. If shim discovery shows multi-workspace calls, the type becomes `string | string[]` and the zod/CLI parse changes — cheap now, annoying later, so confirm against the shim plan before step 1.
- **Float days from cm?** If cm ever sends fractional `--days`, the int-only contract forces shim-side rounding; confirm acceptable before locking the zod schema.
