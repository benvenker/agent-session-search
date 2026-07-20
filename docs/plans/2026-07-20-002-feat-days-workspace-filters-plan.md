---
title: "feat: --days and --workspace deterministic filters (CLI + MCP search_sessions parity) — council synthesis"
type: feat
date: 2026-07-20
status: completed
author: plan-council synthesis (kimi-k3 + codex-56-sol-x-high + fable drafts)
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: plan-council
origin: cm-decoupling initiative — decouple cass-memory (cm) from cass's fragile index; synthesizes docs/investigations/cm-decoupling/plan-council-days-workspace/draft-{kimi-k3,codex-56-sol-x-high,fable}.md from concept docs/plans/2026-07-20-001-feat-days-workspace-filters-plan.md; ships before the companion cass-compat shim plan
---

# feat: `--days` / `--workspace` deterministic filters (CLI + MCP parity)

## Context

cass (the indexed session-search tool cm depends on) is structurally broken on this machine (WAL autocheckpoint livelock, partial-index rebuilds, daily_stats OOM). This repo's grep-based engine searches the same corpus with no index. To let cm consume this engine via the companion cass-compat shim plan, `search_sessions` needs the two filters cm's search calls send: `days` and `workspace`. Filters are deterministic drops — never ranking signals — per DESIGN.md guardrails. This plan ships **before** the shim plan, which consumes these fields in-process.

This synthesis merges three council drafts onto the resolved concept. Where drafts diverged, this plan rules:

- **Codex's dedicated filter module wins** over keeping helpers inside `src/search.ts`: new `src/session-filters.ts` isolates pure predicate logic with injected I/O seams so the tricky edges (dash-encoding, cutoff math) get direct unit tests without the 1,900-line coordinator absorbing another subsystem (AGENTS.md: prefer small testable modules).
- **Codex's strengthened pre-cap requirement is load-bearing**: filtering only before the wrapper's `slice` is insufficient — `shouldDeferBackendCap` must also treat active filters as restrictive, or evidence/debug-mode FFF calls still cap stale hits away. The concept and kimi draft missed this; it is adopted as a hard requirement.
- **Fable's D1 dual-form encoding is adopted**: encode and containment-test both the absolute-resolved and the realpath form of the workspace when they differ (symlinked cwd captured by the recording agent). Strict recall gain, no determinism cost.
- **Fable's D2 reason-split removal counts are adopted** (cheap, makes the warning's `recommendedAction` specific); **D3 (no shared stat cache with ranking in v1)** is accepted as documented inefficiency; **D4 (test-first pure helpers)** sets the execution order.
- **Kimi's tradeoffs are preserved**: async memoized filter applier kept separate from the sync `resultMatchesSourceFilters`; lane verdict order containment → encoded segment → mtime → metadata (days alone never triggers file reads; metadata reads are last resort); nonexistent workspace = empty + warning, exit 0; integer-only days.

### Verified ground truth (design inputs)

- Dash-encoding of workspace dirs is **lossy** (`encode(W) = W.replace(/[^a-zA-Z0-9]/g,"-")`); verified real sibling collision ⇒ **never decode dir names; encode candidate W and compare exactly** (dash-trimmed both sides, leading-dash-guarded, no prefix matching). omp uses two formats (`--…--` and bare); the matcher is source-agnostic.
- Async pre-cap filter attach point exists: `searchSourceSlot` (`src/search.ts:299`) already awaits canonicalization (`:355-357`) before `resultMatchesSourceFilters` (`:358-360`) and caps (`:361-364`).
- Fingerprints stay stable: `stableJson` (`src/followup.ts:67-83`) skips undefined keys ⇒ old filter-less group-followup payloads keep validating byte-identically.
- Existing cap-deferral precedent: restrictive `include` / exact-`paths` requests already force backend-cap deferral; active filters join that path.

## Scope

**In scope**

- Optional `days` (positive integer, rolling file-mtime window) and `workspace` (non-empty path string) on `SearchSessionsInput`, the managed MCP `search_sessions` tool, and the CLI (`--days`, `--workspace`) with 1:1 names and behavior.
- New `src/session-filters.ts` filter kernel: workspace normalization (dual-form), dash encoding, exact-segment match, fixed cutoff, predicate composition (AND across fields), memoized per-session verdicts.
- Pre-cap filtering inside each source slot, backend-cap deferral when filters are active, removal counting, `filters_removed_all_results` warning, `metadata.filters` echo (workspace canonicalized).
- Full `groupCandidates` replay carry-through (six mirror surfaces), CLI/help/capabilities/robot-docs parity, tests, docs.

**Explicit non-goals**

- Native FFF lane: `agent-session-search-native-mcp` and raw FFF tool schemas stay unchanged (fail-closed policy in `src/fff-native-policy.ts` not involved).
- No ranking coupling, no token heuristics in the filter path, no recency-ranking changes, no custom index/SQLite/embeddings.
- `more.evidence` payloads: focused evidence pins canonical `paths` and does not inherit the rolling filter (avoids evidence disappearing across page calls).
- Config-file defaults for either filter; multiple workspace paths (cm sends one); fractional days (shim-side rounding if ever needed); snapshot-stable cutoffs across continuation pages (rolling window documented).
- Full format-specific transcript parsers (e.g. Pool ACP JSON) — the metadata lane reuses only the existing bounded early-record reader.
- Changes to `src/followup.ts` (`stableJson` already skips undefined — verify, don't modify), `src/roots.ts`, `src/fff-backend.ts`, the query rewriter.

## Key decisions

1. **`days` = file-mtime cutoff**, `cutoff = now() − days·86400000`, computed **once per `searchSessions` call** and passed down as a plain number — not re-derived per slot. Injectable `now?: () => number` in `CreateSessionSearchOptions` for tests only. Unstatable files are **dropped** when `days` is set ("provably modified within N days"), kept when unset. mtime ≥ cutoff passes (boundary inclusive).
2. **`workspace` = three deterministic lanes**, evaluated per candidate cheap-to-expensive: (i) containment `pathIsWithin(candidatePath, W)`; (ii) exact dash-encoded segment equality (leading-dash-guarded, dash-trimmed both sides, no prefix matching); (iii) session-metadata lane reusing `projectSignalsFromCandidateMetadata` (`src/search.ts:1140-1177`, parameter loosened to `{source, path}`) with `pathIsWithin(metaPath, W)` — without (iii), codex/pool never match. W is canonicalized once per search (`~`-expand → absolute resolve → realpath when it exists, normalized-absolute fallback when not); per D1, lanes (i)/(iii) test containment against **both** the resolved and realpath forms when they differ, and lane (ii) encodes both forms.
3. **Verdict order: containment → encoded segment → mtime → metadata.** `days` alone never triggers file reads beyond one `stat`; the metadata lane runs only when workspace lanes (i)/(ii) fail. Verdicts memoized per search by **`{source, path}` key** (metadata eligibility differs per source even for one path — codex draft's correction to the path-only key).
4. **Pre-cap at both levels**: apply filters inside `searchSourceSlot` after canonicalization and `resultMatchesSourceFilters`, before `maybeCapResults`; **and** extend `shouldDeferBackendCap` so active filters force backend-cap deferral (requested uncapped FFF results, wrapper cap restored after filtering). Active filters = restrictive, same as `include`/exact-`paths`.
5. **Filters survive `groupCandidates` replay** — mirrored across all six surfaces: strict zod schema, `validateGroupCandidatesFollowup` mismatch checks, `normalizeGroupCandidatesShorthand`, `correctedShape`, `effectiveSearchInput`, `groupFollowup` builder. Server-prepared payloads carry the **canonicalized** workspace so replay doesn't reinterpret `.` or a symlink under a different cwd.
6. **No ranking coupling**; recency ranking untouched; filter verdicts explainable as containment/encoding/metadata only.
7. **Names: `days` / `workspace`** — 1:1 CLI↔MCP, cass-arg compatible for the shim. `days` integer-only (`z.number().int().positive()`, `parsePositiveInteger`); `--days 0` is a parse error, exit 1.
8. **Nonexistent workspace is not a parse error**: empty results + `filters_removed_all_results` warning with `recommendedAction`, exit 0, mirroring the missing-root policy. The warning fires only when filters were active ∧ 0 survivors ∧ `filterRemovedCount > 0` (removed counts only removals by the new predicates after existing include/path eligibility — never for ordinary no-match searches).
9. **Echo**: `metadata.filters = {days?, workspace?}` present only when supplied; workspace echoed canonicalized; no computed cutoff or response timestamp exposed (output stays timestamp-free for determinism).
10. **Managed one-tool boundary preserved**: `tools/list` still shows exactly `search_sessions`; additive optional fields, no result-contract version bump.

## Implementation sequence

Three commit-sized checkpoints, dependency-ordered. Never land checkpoint B without A (surfaces are dead wiring without the core).

### Checkpoint A — filter kernel + engine core

1. **`src/types.ts`** — `SearchSessionsInput` (:11-24) + `GroupCandidatesFollowupInput` (:82-102): add `days?: number; workspace?: string`. `SearchSessionsMetadata` (:179-196): add `filters?: {days?: number; workspace?: string}`. Warning code union (:121-130): add `"filters_removed_all_results"`.
2. **`src/session-filters.ts` (new) + `test/session-filters.test.ts` (new, test-first per D4)** — pure helpers `encodeWorkspaceDirName`, `stripDashes`, `workspaceEncodedSegmentMatch`, `canonicalWorkspacePath` (dual-form), `prepareSessionFileFilters`, plus the memoized async evaluator `resultPassesSessionFileFilters` / `applySessionFileFilters`. The module accepts injected callbacks for `mtime` and metadata project paths (so `src/search.ts` reuses its existing bounded early-metadata reader — no second transcript parser) and stays unaware of candidates, match groups, FFF, ranking, and warnings. Unit-test the full predicate truth table first: cutoff boundary ±1ms, future mtime, unstatable drop, claude-style `-data-projects-…` and both omp formats match, verified sibling collision (`-…-themodernsocial` vs `-…-themodernsocial-agent-platform`) does NOT cross-match, leading-dash guard, dual-form symlink match, metadata-lane descendant/parent/sibling/token-only cases, AND composition, memoization (stat/metadata callbacks ≤1 per source+path; two sources sharing a path don't share metadata-sensitive verdicts).
3. **`src/search.ts`** — compute prepared filters once in `searchSessions` (~:97-113, after replay normalization); replace effective input's workspace with the canonical value before continuation planning; extend `shouldDeferBackendCap` for active filters; thread filters through `SourceSearchSlotInput` (:273-285); apply between :360 and :361 via the memoized applier (keep the existing sync `resultMatchesSourceFilters` pass separate — kimi tradeoff (a)); add reason-split `filterRemovedCount` (`days` / `workspace` / `stat_failed`) to `SourceSearchSlotResult` (:287-297) per D2; loosen `projectSignalsFromCandidateMetadata` to accept `{source, path}`; emit `filters_removed_all_results` with reason-aware `recommendedAction` in the aggregation path (~:186-207); extend `searchMetadata` (:1689-1729); spread `days`/`workspace` in `effectiveSearchInput` (:1660-1687) and `groupFollowup` (:853-894); add `now?` to `CreateSessionSearchOptions` (:1784-1794).
4. **Core tests** in `test/search.test.ts` via the `createBackend` seam (pattern :2716) with tmp files + `utimes`:
   - **Cap starvation characterization test first** (codex execution note): explicit cap 1, ineligible first backend hit, assert the fake backend received `maxResults: undefined`, the later eligible hit survives, and the wrapper returns ≤1 hit.
   - days drops 90-day-old file at `days:30` in evidence and candidates modes; control without days keeps it; unstatable path dropped with reason `stat_failed` when days set, kept when unset; injected `now` sampled once for a multi-source request.
   - encoded-segment lanes (claude + both omp formats), sibling `-…-extra` rejected; containment lane; metadata lane for a codex-named source with `{"cwd":…}` first line.
   - filter-to-empty ⇒ `results: []` + one warning + `metadata.filters` echo (workspace canonicalized); no lexical hits / source failure / include-only removal ⇒ NO warning.
   - partial source success coexists with filtered results from another source; ranking order among survivors unchanged; no filter data in ranking debug components.
   - group page carries canonical filter values; replay returns only filtered candidates with valid fingerprint.

### Checkpoint B — MCP + CLI surfaces

5. **`src/tool.ts`** — zod: `days: z.number().int().positive().optional().describe(…)`, `workspace: z.string().min(1).optional().describe(…)` in `searchSessionsInputSchema` (:60-163) **and** strict `groupCandidatesFollowupSchema` (:31-58); mismatch checks in `validateGroupCandidatesFollowup` (:258-357) modeled on `maxResultsPerSource` (:318-326); carry fields in `normalizeGroupCandidatesShorthand` (:359-428) and `correctedShape` (:179-206). Tests in `test/tool.test.ts`: accept/reject (`days:1.5`, `days:0`, negative, `workspace:""`); shorthand carry; mismatch ⇒ `SearchSessionsInputError` with correct `invalidField` and filter-aware corrected shape; **pinned fingerprint literal for a filter-less payload unchanged, changes when `days` is added**; tampering fails validation.
6. **`src/cli.ts`** — `ParsedArgs` (:29-49); `KNOWN_OPTIONS` (:67-90) gains `--days`, `--workspace` (typo correction: `--dsys`→`--days` d=1, `--workspce`→`--workspace` d=1); parse branches (numeric via `parsePositiveInteger` :709-718; string via the `--cwd` pattern :146-153); `groupCandidatesMixedFlags` (:392-432) rejects mixing either flag with `--group-candidates`; map in `searchInputFromParsedArgs` (:546-565). Exit codes unchanged (`--days 0`/missing value/non-numeric → parse error exit 1 with `user_input_error` envelope and copy-pasteable `suggestedCommand`).
7. **`src/help.ts`** — `cliHelpText` usage + two option lines + one example; `cliCapabilities` usage strings + warning meaning under `contract.warnings` (:171-186); `robotDocsGuide` one line (deterministic drops, survive replay); `robotTriage` one recommended command; `mcpSearchSessionsDescription` one sentence. Check `test/mcp-smoke.test.ts` for pinned description strings before assuming green.
8. **CLI tests** in `test/cli.test.ts` — flag mapping (**update the exact-`toEqual` tests at :523-545/:563-577/:589-603 in the same commit** — they break otherwise); error paths; typo suggestions with `suggestedCommand`; group-mix rejection naming the offending flag; help/capabilities/triage contain both flags. MCP smoke: introspection exposes the new optional fields; managed `tools/list` still exactly one tool; native smoke fixtures unchanged.

### Checkpoint C — docs + verification tail

9. **Docs** — `docs/cli.md` flag table (:20-46) + lanes/lossiness/drop-rule paragraph (rolling window, unstatable-drop rule, residual punctuation-collision limitation); `docs/mcp.md` input table (:73-83) + replay + warning note + "MCP callers and the shim should send absolute workspaces"; `DESIGN.md` inlined input type (:85-97) + deterministic-filters paragraph near :106; `CONTEXT.md` key-modules line for `src/session-filters.ts` + deterministic-drop guardrail; `UBIQUITOUS_LANGUAGE.md` add `Session Filter` / `Days Filter` / `Workspace Filter` distinct from ranking `Project Match` (codex KTD); `docs/troubleshooting.md` warning-recovery note; `test/readme.test.ts`/docs-contract assertions for the new terms and warning.
10. **Full verification contract** (below).

## Testing and validation

Gates: `npm run check && npm test && npm run build && npm run smoke && npm run check:dcg` all green.

Live-corpus proofs (each independently checkable):

- `npm run dev:cli -- "cass" --json --days 2` → every returned `path` has mtime ≤ 48h — verify with `jq`+`stat` one-liner over the output paths.
- `npm run dev:cli -- "cass" --json --workspace /data/projects/agent-session-search` → returned paths only from this repo's session dirs across ≥2 sources (claude dash-dir AND omp dash-dir present; zero paths from other workspaces).
- Symlink probe (D1): `ln -s` a temp alias to this repo, search with the alias as `--workspace`, expect results identical to the canonical path.
- `--days 3650 --workspace /nonexistent/ws` → `results: []`, `filters_removed_all_results` warning with `recommendedAction`, exit 0.
- `--dsys 7` → exit 1, "did you mean --days?", copy-pasteable `suggestedCommand`.
- `capabilities --json` documents both flags; `--robot-triage` shows a filter example.
- **MCP parity proof**: `npm run dev:mcp`, call `search_sessions` with `{"query":"cass","days":7,"workspace":"/data/projects/agent-session-search","maxResultsPerSource":5}` (the exact shim call shape) → same filtering behavior as CLI; `more.groupCandidates` replay round-trips without a teaching error.
- **Native-lane isolation proof**: native MCP smoke path shows FFF tool schemas without `days`/`workspace`.
- **Determinism proof**: same filtered CLI query twice → byte-identical JSON (output has no timestamps).

## Risks and rollback

- **Missing one of the six groupCandidates mirror surfaces** — highest-probability bug; guarded by the replay round-trip test, the strict-schema mismatch test, and the pinned-fingerprint tests.
- **Backend cap left active in evidence/debug mode** makes the filter silently incorrect; guarded by the cap-starvation characterization test asserting `maxResults: undefined` at the backend.
- **Exact-equality CLI mapping tests break** until updated — keep in the same commit as the CLI change.
- **Cap deferral increases I/O/memory** on broad filtered queries — bounded by existing FFF timeouts, per-session memoization, and restored post-filter caps; documented as correctness-over-efficiency tradeoff.
- **Metadata-lane I/O cost** — mitigated by lane ordering (metadata last), `{source,path}` memoization, and existing `SESSION_METADATA_MAX_BYTES`/`MAX_LINES` bounds; no new budget. Double-stat with ranking (D3) accepted; revisit only if the shim's latency budget proof fails.
- **Dash encoding is lossy** — exact-segment-only matching, documented residual punctuation-collision limitation; containment/metadata lanes preferred when present.
- **Relative MCP workspace depends on server cwd** — accepted for CLI ergonomics; canonicalize + echo; docs tell MCP callers/shim to send absolute paths.
- **Rolling window drift across long-lived continuation pages** — documented; recompute once per invocation, never a hidden absolute timestamp.
- **Warning misfire** — require removed>0 and count only post-eligibility removals; pinned in tests.
- **Rollback**: additive optional fields only; reverting the branch restores prior behavior — filter-less requests, fingerprints, and result shapes are untouched (guarded by pinned-literal tests).

## Open questions (only if they change execution order)

1. **Pool ACP `.json` workspace matching a launch requirement for the shim?** Default: no — three lanes guaranteed only where a path or readable bounded early metadata supplies workspace identity. If yes, characterize real Pool JSON first and add a bounded format-specific extraction unit _before_ checkpoint A; do not let the search wiring grow a full transcript parser.
2. **Does the shim need filters echoed in `more.evidence` payloads?** Default: no (non-goal above). If yes, add the mirror in checkpoint A step 3 before landing.
3. **Does any strict downstream consumer reject additive `metadata.filters`?** Default: no version bump. If one does, decide the version migration before checkpoint B so fingerprints, fixtures, and docs update once.
4. **Should the shim reuse `prepareSessionFileFilters` for its timeline/stats walkers?** If yes, export it from `src/session-filters.ts` during checkpoint A (trivial at that point, churny later).

None of these changes the default path above; record any non-default answer before the affected checkpoint begins.
