---
title: "feat: --days and --workspace deterministic filters (CLI + MCP search_sessions parity)"
type: feat
date: 2026-07-20
status: superseded
author: claude-fable-5 planning session (design agents + live-corpus verification)
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
origin: cm-decoupling initiative — decouple cass-memory (cm) from cass's fragile index; see companion plan 2026-07-20-001-feat-cass-compat-shim-plan.md
---

# feat: `--days` / `--workspace` filters (CLI + MCP parity)

## Context

cass (the indexed session-search tool cm depends on) is structurally broken on this machine: incremental indexing livelocks (WAL autocheckpoint disabled — fixed upstream, unreleased), interrupted full rebuilds leave a partial index, and daily_stats repair OOMs inside frankensqlite (upstream #329, open, fails on main too). This repo's grep-based engine searches the same corpus with no index. To let cm consume this engine (via the companion cass-compat shim plan), `search_sessions` needs the two filters cm's search calls send: `--days` and `--workspace`. Filters are deterministic drops — never ranking signals — per DESIGN guardrails. Ships before the shim plan, which consumes these input fields in-process.

### Verified ground truth (design inputs)

- Dash-encoding of workspace dirs is **lossy** (`encode(W) = W.replace(/[^a-zA-Z0-9]/g,"-")`); verified real sibling collision (`-data-projects-themodernsocial` vs `-data-projects-themodernsocial-agent-platform`) ⇒ **never decode dir names; encode candidate W and compare exactly** (dash-trimmed both sides). omp uses two formats (`--…--` and bare); matcher is source-agnostic (omp is a configured source, not a built-in).
- Async pre-cap filter attach point exists: `searchSourceSlot` (`src/search.ts:299`) already awaits canonicalization (`:355-357`) before `resultMatchesSourceFilters` (`:358-360`) and caps (`:361-364`).
- Fingerprints stay stable: `stableJson` (`src/followup.ts:67-83`) skips undefined keys ⇒ old filter-less group-followup payloads keep validating byte-identically.

### Key decisions (with rationale)

1. **`--days` = file-mtime cutoff**, computed once per search (`cutoff = now() − days·DAY_MS`), applied **pre-cap per source slot** so caps aren't wasted on stale files. Unstatable files are **dropped** when `days` is set (contract: "provably modified within N days"). Testability via injectable `now?: () => number` in `CreateSessionSearchOptions`; no SOURCE_DATE_EPOCH.
2. **`--workspace` = three deterministic lanes**, all modes: (i) containment `pathIsWithin(P, W)`; (ii) exact dash-encoded segment match (leading-dash-guarded, no prefix matching — precision over rare worktree miss); (iii) session-metadata lane reusing `projectSignalsFromCandidateMetadata` (`src/search.ts:1140-1177`, parameter loosened to `{source, path}`) with `pathIsWithin(metaPath, W)` — without (iii), codex/pool never match. **No token heuristics** (ranking-only; filters must be deterministic).
3. **Filters survive `groupCandidates` replay** — mirrored across all followup surfaces (strict schema would otherwise reject echoed payloads).
4. **No ranking coupling** — filter is a filter; recency ranking untouched.
5. **Names: `days` / `workspace`** — 1:1 CLI↔MCP field convention; cass-arg compatibility for the shim.

### Implementation steps (dependency-ordered)

1. **`src/types.ts`** — `SearchSessionsInput` (:11-24) + `GroupCandidatesFollowupInput` (:82-102): add `days?: number; workspace?: string`. `SearchSessionsMetadata` (:179-196): add `filters?: {days?: number; workspace?: string}` (workspace echoed canonicalized). Warning code union (:121-130): add `"filters_removed_all_results"`.
2. **`src/search.ts`** — new helpers near ranking privates: `prepareSessionFileFilters`, `canonicalWorkspacePath` (~-expand, resolve absolute, realpath fallback; pattern of `:1292-1302`), `encodeWorkspaceDirName`, `stripDashes`, `workspaceEncodedSegmentMatch`, `resultPassesSessionFileFilters`, `applySessionFileFilters` (memoized `Map<path, Promise<boolean>>`; verdict order: containment → encoded segment → mtime → metadata). Wire: compute filters in `searchSessions` (~:97-113); thread through `SourceSearchSlotInput` (:273-285); apply between `:360` and `:361`; add `filterRemovedCount` to slot result (:287-297); emit `filters_removed_all_results` warning with `recommendedAction` when filters active ∧ 0 results ∧ removed>0 (~:186-207); extend `searchMetadata` (:1689-1729); spread `days`/`workspace` in `effectiveSearchInput` (:1660-1687) and `groupFollowup` (:853-894); add `now?` to `CreateSessionSearchOptions` (:1784-1794).
3. **`src/tool.ts`** — zod: `days: z.number().int().positive().optional().describe(…)`, `workspace: z.string().min(1).optional().describe(…)` in `searchSessionsInputSchema` (:60-163) **and** strict `groupCandidatesFollowupSchema` (:31-58); mismatch checks in `validateGroupCandidatesFollowup` (:258-357) modeled on `maxResultsPerSource` (:318-326); carry fields in `normalizeGroupCandidatesShorthand` (:359-428) and `correctedShape` (:179-206).
4. **`src/cli.ts`** — `ParsedArgs` (:29-49); `KNOWN_OPTIONS` (:67-90) gains `--days`, `--workspace` (typo correction: `--dsys`→`--days` d=1, `--workspce`→`--workspace` d=1); parse branches (numeric via `parsePositiveInteger` :709-718; string via `--cwd` pattern :146-153); `groupCandidatesMixedFlags` (:392-432) rejects mixing; map in `searchInputFromParsedArgs` (:546-565). Exit codes unchanged (`--days 0` → parse error exit 1; nonexistent workspace is NOT an error → empty + warning, exit 0, mirroring missing-root policy).
5. **`src/help.ts`** — `cliHelpText` usage + two option lines + one example; `cliCapabilities` usage strings + warning meaning under `contract.warnings` (:171-186); `robotDocsGuide` one line (deterministic drops, survive replay); `robotTriage` one recommended command; `mcpSearchSessionsDescription` one sentence.
6. **Tests** — `test/cli.test.ts` (mapping incl. updating exact-`toEqual` tests at :523-545/:563-577/:589-603; `--days 0`/non-numeric errors; typo suggestions; group-mix rejection). `test/tool.test.ts` (schema accept/reject incl. `days:1.5`, `workspace:""`; shorthand carry; mismatch → `SearchSessionsInputError` invalidField). `test/search.test.ts` via `createBackend` seam (pattern `:2716`) with tmp files + `utimes`: (1) days drops 90-day-old file at `days:30` in evidence+candidates modes; (2) control without days; (3) unstatable path dropped; (4) claude-style + omp-style encoded dir match, sibling `-…-extra` does NOT match; (5) metadata lane: codex-named source with `{"cwd":…}` first line matches/rejects; (6) containment lane; (7) filter-to-empty → `[]` + warning + `metadata.filters` echo; (8) followup replay keeps filters, fingerprint valid; (9) pinned fingerprint literal for filter-less payload unchanged, changes when `days` added. Check mcp-smoke tests for pinned description strings.
7. **Docs** — `docs/cli.md` flag table (:20-46) + lanes/lossiness/drop-rule paragraph; `docs/mcp.md` input table (:73-83) + replay + warning note; `DESIGN.md` inlined input type (:85-97) + deterministic-filters paragraph near :106.

### Plan A verification contract (beyond green tests)

- `npm run check` && `npm test` green.
- **Live-corpus proofs** (each independently checkable):
  - `npm run dev:cli -- "cass" --json --days 2` → every returned `path` has `mtime` ≤ 48h old — verify with `jq`+`stat` one-liner over the output paths.
  - `npm run dev:cli -- "cass" --json --workspace /data/projects/agent-session-search` → returned paths only from this repo's session dirs across ≥2 sources (claude dash-dir AND omp dash-dir present in output; zero paths from other workspaces).
  - `--days 3650 --workspace /nonexistent/ws` → `results: []`, `filters_removed_all_results` warning with `recommendedAction`, exit 0.
  - `--dsys 7` → exit 1, "did you mean --days?", copy-pasteable `suggestedCommand`.
  - `capabilities --json` documents both flags; `--robot-triage` shows a filter example.
- **MCP parity proof**: `npm run dev:mcp`, call `search_sessions` with `{"query":"cass","days":7,"workspace":"/data/projects/agent-session-search","maxResultsPerSource":5}` (the exact shim call shape) → same filtering behavior as CLI; group-followup `more.groupCandidates` replay round-trips without a teaching error.
- **Determinism proof**: run the same filtered CLI query twice → byte-identical JSON (modulo none — output has no timestamps).

Risks: missing one groupCandidates mirror surface (guarded by test 8); the two exact-equality CLI mapping tests break until updated (same commit). Non-goals: config defaults for filters, ranking coupling, `more.evidence` changes, new subcommands.
