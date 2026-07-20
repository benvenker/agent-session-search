---
title: "Plan-council draft (fable): --days / --workspace deterministic filters"
author: fable
date: 2026-07-20
concept: docs/plans/2026-07-20-001-feat-days-workspace-filters-plan.md
role: independent planning draft for the plan council (cm-decoupling initiative)
---

# Draft (fable): `--days` / `--workspace` filters, CLI + MCP parity

## 1. Concept intent

Add two deterministic, drop-only result filters to the existing search flow — `days` (file-mtime cutoff) and `workspace` (path/workspace containment) — exposed identically on the CLI (`--days`, `--workspace`) and the managed MCP `search_sessions` input. The purpose is to make this repo's index-free grep engine consumable by cass-memory (`cm`) through the companion cass-compat shim plan: cm's search calls send exactly these two filters, and cass's own index is structurally unreliable on this machine. Filters must be deterministic drops (never ranking signals), must survive `groupCandidates` followup replay, and must not disturb the one-tool managed MCP boundary or the FFF-as-engine posture (DESIGN.md, ADR 0001).

Anchor verification (2026-07-20, this session): `searchSourceSlot` at `src/search.ts:299` with canonicalization at `:355-357`, `resultMatchesSourceFilters` at `:358-360`, and capping at `:361-364`; `projectSignalsFromCandidateMetadata` at `src/search.ts:1140`; `effectiveSearchInput` at `:1660`; `CreateSessionSearchOptions` at `:1784`; `stableJson` at `src/followup.ts:67`; `searchSessionsInputSchema` at `src/tool.ts:60` and `groupCandidatesFollowupSchema` at `:31`; `KNOWN_OPTIONS` at `src/cli.ts:67`; `parsePositiveInteger` at `:709`. The concept document's ground truth holds against current mainline.

## 2. Recommended implementation shape

Adopt the concept plan's architecture essentially as written. Its three load-bearing decisions are correct and I found no better alternative:

1. **Pre-cap, per-source-slot filtering** at the already-async attach point in `searchSourceSlot`, between canonicalization/source-filtering and `maybeCapResults`. This is the only point where paths are canonical, source metadata is attached, and caps have not yet consumed budget on stale files. Post-cap filtering would silently under-fill `maxResultsPerSource`; backend-level filtering (passing workspace hints into FFF `include` globs) was considered and rejected — include patterns are per-source post-search filters by design (DESIGN.md "native lane" section), the encoding differs per agent tool, and pushing filters into the engine violates the keep-the-wrapper-small rule.
2. **Never decode dash-encoded directory names.** Encoding is lossy (verified sibling collision in the concept doc). Encode the candidate workspace and compare exactly, dash-trimmed both sides, leading-dash-guarded, no prefix matching.
3. **Three deterministic workspace lanes** (containment, encoded-segment, session-metadata via a loosened `projectSignalsFromCandidateMetadata`), and no token heuristics. Without the metadata lane, codex/pool sources can never match a workspace filter; with token heuristics, the filter stops being deterministic.

### Where this draft diverges from the concept (preserved disagreements)

- **(D1) Encode both the resolved and the realpath forms of the workspace.** The concept canonicalizes W (~-expand → resolve → realpath fallback) and encodes once. If the recording agent captured a _non-resolved_ cwd (symlinked project dir) while realpath resolves elsewhere — or vice versa — a single encoding misses. Cheap fix: compute encoded candidates from the absolute-resolved form _and_ the realpath form when they differ; a hit on either passes lane (ii). Same for `pathIsWithin` in lanes (i)/(iii): test containment against both forms. This is a strict recall improvement with no determinism cost.
- **(D2) Count stat-failure drops distinctly.** The concept drops unstatable files when `days` is set ("provably modified within N days" — agreed, fail-closed is right for a filter feeding cm). But fold the drop counts into diagnostics: track `filterRemovedCount` split by reason (`days`, `workspace`, `stat_failed`) in the slot result. Cost is trivial; it makes the `filters_removed_all_results` warning's `recommendedAction` specific ("all N drops were stat failures — check permissions" vs "widen --days").
- **(D3) Double-stat awareness, not premature sharing.** Candidate ranking already stats files for recency buckets; the days filter stats them again. Do _not_ try to share a stat cache between filter and ranking in v1 — the filter runs per-slot pre-merge, ranking runs post-merge, and coupling them would thread state across the seam the concept deliberately keeps clean. The OS dentry cache makes the second stat cheap. Record it as a known, accepted inefficiency; revisit only if the shim's 8-second budget proof fails.
- **(D4) Test-first for the pure helpers.** `encodeWorkspaceDirName`, `stripDashes`, `workspaceEncodedSegmentMatch`, and the cutoff math are pure functions with a verified tricky edge (sibling collision). Write their unit tests before wiring `searchSourceSlot`. The integration wiring can then land against an already-proven matcher. This is an execution-order note, not a scope change.

Everything else in the concept — naming (`days`/`workspace`), zod shapes, replay mirroring, warning code, injectable `now`, exit-code policy (nonexistent workspace ⇒ empty + warning + exit 0), non-goals (no config defaults, no ranking coupling) — is adopted unchanged.

## 3. Ordered implementation steps

Dependency-ordered; U-IDs are draft-local. U1–U3 are the engine commit; U4–U5 the surfaces commit; U6–U7 the docs/verification tail. One branch, three commit-sized checkpoints.

### U1. Types and contracts (`src/types.ts`)

- `SearchSessionsInput` (:11-24) and `GroupCandidatesFollowupInput` (:82-102): add `days?: number; workspace?: string`.
- `SearchSessionsMetadata` (:179-196): add `filters?: { days?: number; workspace?: string }` (workspace echoed canonicalized).
- `SearchWarningCode` union (:121-130): add `"filters_removed_all_results"`.
- Test expectation: none — types-only; compile gate is `npm run check`.

### U2. Pure filter helpers + unit tests (test-first, per D4)

- New helpers in `src/search.ts` near the ranking privates: `canonicalWorkspacePath` (dual-form per D1), `encodeWorkspaceDirName`, `stripDashes`, `workspaceEncodedSegmentMatch`, `prepareSessionFileFilters`, `resultPassesSessionFileFilters`.
- Tests in `test/search.test.ts`: claude-style and omp-style encoded dir match; the verified sibling collision (`-…-themodernsocial` vs `-…-themodernsocial-agent-platform`) must NOT cross-match; leading-dash guard; dash-trim on both sides; symlink/realpath dual-form match (D1); cutoff arithmetic with injected `now`.

### U3. Engine wiring (`src/search.ts`)

- Compute filters once in `searchSessions` (~:97-113); thread through `SourceSearchSlotInput` (:273-285); apply `applySessionFileFilters` (memoized `Map<path, Promise<boolean>>`, verdict order containment → encoded segment → mtime → metadata) between `:360` and `:361`; add reason-split `filterRemovedCount` to `SourceSearchSlotResult` (:287-297) per D2.
- Loosen `projectSignalsFromCandidateMetadata` (:1140-1177) parameter to `{source, path}` for lane (iii).
- Emit `filters_removed_all_results` with `recommendedAction` when filters active ∧ 0 results ∧ removed > 0 (~:186-207); extend `searchMetadata` (:1689-1729); spread `days`/`workspace` in `effectiveSearchInput` (:1660-1687) and the group followup builder (:853-894); add `now?: () => number` to `CreateSessionSearchOptions` (:1784-1794).
- Tests (via the `createBackend` seam, pattern `test/search.test.ts:2716`, tmp files + `utimes`): days drops 90-day-old file at `days:30` in evidence and candidates modes; control without `days`; unstatable path dropped with reason `stat_failed`; metadata lane for a codex-named source with `{"cwd":…}` first line; containment lane; filter-to-empty ⇒ `[]` + warning + `metadata.filters` echo.

### U4. MCP surface (`src/tool.ts`)

- `days: z.number().int().positive()`, `workspace: z.string().min(1)`, both optional with descriptions, in `searchSessionsInputSchema` (:60-163) AND strict `groupCandidatesFollowupSchema` (:31-58).
- Mismatch checks in `validateGroupCandidatesFollowup` (:258-357) modeled on `maxResultsPerSource`; carry fields in `normalizeGroupCandidatesShorthand` (:359-428) and `correctedShape` (:179-206).
- Tests in `test/tool.test.ts`: accept/reject (`days:1.5`, `days:0`, `workspace:""`); shorthand carry; mismatch ⇒ teaching error with correct `invalidField`.

### U5. CLI surface (`src/cli.ts`, `src/help.ts`)

- `ParsedArgs` (:29-49); `KNOWN_OPTIONS` (:67-90) + typo suggestions (`--dsys`→`--days`, `--workspce`→`--workspace`); numeric parse via `parsePositiveInteger` (:709-718), string parse via the `--cwd` pattern; reject mixing with `groupCandidates` flags (:392-432); map in `searchInputFromParsedArgs` (:546-565). `--days 0` ⇒ parse error exit 1; nonexistent workspace ⇒ empty + warning, exit 0 (mirrors missing-root policy).
- `src/help.ts`: usage lines, option docs, one example, `contract.warnings` entry, `robotDocsGuide` + `robotTriage` mentions, `mcpSearchSessionsDescription` sentence.
- Tests in `test/cli.test.ts`: flag mapping (update the exact-`toEqual` fixtures at :523-545/:563-577/:589-603 in the same commit); error paths; typo suggestion with copy-pasteable `suggestedCommand`; group-mix rejection. Check mcp-smoke tests for pinned description strings.

### U6. Replay-integrity tests

- Followup replay keeps filters and fingerprint validates (`stableJson` skips undefined ⇒ old filter-less payloads stay byte-identical — pin one literal fingerprint for a filter-less payload, assert it is unchanged, and assert it changes when `days` is added).

### U7. Docs + live-corpus verification

- `docs/cli.md` flag table + lanes/lossiness/drop-rule paragraph; `docs/mcp.md` input table + replay + warning note; `DESIGN.md` inlined input type (:85-97) + deterministic-filters paragraph.
- Run the full verification contract in §5.

## 4. Files and modules likely to change

| File                                                           | Change                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/types.ts`                                                 | input/followup/metadata/warning types                              |
| `src/search.ts`                                                | filter helpers, slot wiring, metadata, followup spread, `now` seam |
| `src/tool.ts`                                                  | zod schemas, followup validation, shorthand carry                  |
| `src/cli.ts`                                                   | flags, parsing, typo map, group-mix guard, input mapping           |
| `src/help.ts`                                                  | usage, capabilities, robot docs, MCP description                   |
| `test/search.test.ts`, `test/tool.test.ts`, `test/cli.test.ts` | new + updated fixtures                                             |
| `docs/cli.md`, `docs/mcp.md`, `DESIGN.md`                      | contract documentation                                             |

No changes to `src/roots.ts`, `src/fff-backend.ts`, the query rewriter, ranking, or either MCP server binary's tool surface.

## 5. Tests and validation commands

- `npm run check` — typecheck gate after U1 and continuously.
- `npm test` — full suite; new coverage listed per unit above.
- Live-corpus proofs (from the concept, adopted verbatim):
  - `npm run dev:cli -- "cass" --json --days 2` → every returned path has mtime ≤ 48h (verify with `jq` + `stat`).
  - `npm run dev:cli -- "cass" --json --workspace /data/projects/agent-session-search` → paths only from this repo's session dirs across ≥2 sources; zero foreign-workspace paths.
  - `--days 3650 --workspace /nonexistent/ws` → `results: []`, `filters_removed_all_results` warning with `recommendedAction`, exit 0.
  - `--dsys 7` → exit 1, "did you mean --days?", copy-pasteable `suggestedCommand`.
  - `capabilities --json` documents both flags; `--robot-triage` shows a filter example.
- MCP parity: `npm run dev:mcp`, call `search_sessions` with `{"query":"cass","days":7,"workspace":"/data/projects/agent-session-search","maxResultsPerSource":5}` (the exact shim call shape) → same behavior as CLI; `more.groupCandidates` replay round-trips without a teaching error.
- Determinism: identical filtered CLI query twice → byte-identical JSON.
- Added for D1: one live symlink probe — `ln -s` a temp alias to this repo, search with the alias as `--workspace`, expect identical results to the canonical path.

## 6. Risks, constraints, and open questions

**Risks**

- _Missed replay mirror surface._ Filters must appear in every followup echo path (`effectiveSearchInput`, group followup builder, tool-side shorthand/corrected-shape, strict schema). One miss ⇒ strict schema rejects echoed payloads. Guarded by U6; this is the highest-severity failure mode.
- _Exact-equality CLI fixtures break mid-change._ The `toEqual` mapping tests must be updated in the same commit as U5 or CI is red between commits.
- _Latency under the shim's 8s budget._ Per-file stat + optional metadata reads on large result sets. Memoization bounds work to unique paths; D3 documents the accepted double-stat. If the companion plan's latency proof fails, the fix is a shared stat cache — a known follow-up, not a v1 blocker.
- _Encoded-segment precision over recall._ No prefix matching means rare worktree-suffixed dirs miss lane (ii); they can still pass lanes (i)/(iii). Accepted by the concept; D1 narrows the symlink slice of this gap.

**Constraints (non-negotiable, from DESIGN/ADR/AGENTS)**

- Managed MCP surface stays exactly `search_sessions`; no new tools, no ranking coupling, no index. Filters are drops, echoed in `metadata.filters`, never scores.
- Missing/unreadable inputs warn and continue; they never fail the whole search.
- This plan ships **before** the cass-compat shim plan, which consumes these fields in-process.

**Open questions that would change implementation order**

1. _Reason-split removal counts (D2) — in-scope for v1?_ If council rejects, U3 shrinks slightly; nothing downstream depends on it (the shim reads results, not diagnostics).
2. _Dual-form encoding (D1) — accepted?_ If rejected, drop the symlink tests from U2/U5 and keep the concept's single canonical form; no reordering needed.
3. _Should `days` also gate the timeline/stats walkers in the shim plan?_ Out of scope here, but if the shim plan wants to reuse `prepareSessionFileFilters`, export it — decide before U3 lands to avoid a re-export churn commit.
4. _Fractional days?_ Locked to positive integers (cm sends integers). If any future consumer needs hours, that is a new design pass, not a loosened zod check.
