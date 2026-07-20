---
title: "feat: cass-compatible shim bin (agent-session-search-cass-shim) for cass-memory"
type: feat
date: 2026-07-20
status: completed
author: plan-council synthesis (drafts: kimi-k3, codex-56-sol-x-high, claude-fable-5; contracts pinned from cm binary + cass v0.6.22 Rust source)
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: specialized-plan-council
origin: docs/plans/2026-07-20-001-feat-cass-compat-shim-plan.md (resolved concept); council drafts under docs/investigations/cm-decoupling/plan-council-cass-shim/; companion predecessor docs/plans/2026-07-20-001-feat-days-workspace-filters-plan.md (ships first)
---

# feat: cass-compatible shim bin (`agent-session-search-cass-shim`)

## Goal Capsule

- **Objective:** Ship a fifth bin, `agent-session-search-cass-shim`, that is CLI-compatible with the six cass verbs cass-memory (`cm`) actually calls, backed in-process by this package's index-free FFF engine, so `cm context` / `cm reflect` / `cm doctor` work regardless of the real cass index's health.
- **Authority:** `docs/plans/2026-07-20-001-feat-cass-compat-shim-plan.md` is the resolved concept and pins the cm/cass consumption contract from evidence; `DESIGN.md`, `CONTEXT.md`, and `docs/adr/0001-fff-core-and-native-policy-strictness.md` define the FFF-as-core and two-lane MCP boundaries this plan must not disturb.
- **Execution profile:** Standard cross-cutting TypeScript work: one new bin entrypoint, one new module directory, focused fixtures and contract tests, packaging wiring, documentation, and live `cm` acceptance proof. One branch, three commits, no release between commits.
- **Stop conditions:** Stop before release if the predecessor `days`/`workspace` filter plan is not merged, if either MCP tool catalog changes, if any lexical retrieval bypasses FFF, if export needs a general transcript-parser framework, or if `cm context` cannot complete within its 8s process timeout with safe margin (<4s target on the reference corpus).
- **Tail ownership:** The implementation owns all six command surfaces, packaging, activation/rollback documentation, live `cm` verification, and cleanup of every spawned FFF child. It does not own cass repair, cass passthrough, a new search lane, or a general export product.

---

## Product Contract

### Concept Intent

`cm` shells out to a `cass` binary (path from `~/.cass-memory/config.json` `cassPath` or the `CASS_PATH` env var) for six operations: availability check, search, export, timeline, stats, and (indirectly) unprocessed-session discovery. The installed cass 0.6.22 index is structurally unreliable on this machine (livelocked incremental, partial-index loops, daily_stats OOM, `checkpoint_incomplete` robot errors; upstream #329 open). This package already has an index-free engine over the same corpus. The shim replaces only the subprocess contract `cm` consumes — no cm changes, no MCP surface changes, no index.

This is a **cm-interop compatibility adapter lane**, not a third search surface: it re-presents existing engine output in real-cass v0.6.22 wire shapes. The managed MCP surface stays exactly `search_sessions`; the native lane stays as-is; the CLI is untouched (the shim is a separate bin, never a CLI subcommand).

### Evidence-pinned consumption contract (baseline from the concept; re-verify on every cm upgrade)

Pinned from `strings ~/.local/bin/cm` (cm 0.2.12, 2026-07-19 build) and the cass v0.6.22 Rust source. Full citations live in the concept doc; the sharpest points are restated here because the code must satisfy them exactly.

- **Availability gate is `[cassPath, "--version"]`** via spawnSync, 2s timeout, exit-0-only. It is NOT `cass health`. The `--version` path must return fast, before any engine work.
- **search argv**: `["search", ("--limit",N)?, ("--days",N)?, ("--agent",slug)*, ("--workspace",w)?, ("--fields",csv)?, "--robot", "--", query]`. cm context sends `{limit:10, days:7, workspace?, timeout:8}` — an **8-second wall-clock budget**.
- **cm's acceptance schema (zod; every hit `.parse`d — one bad hit degrades the whole search)**: `source_path: string` REQ; **`line_number: number` REQ, NOT nullable — always emit a number (fallback 1)**; `agent: string` REQ; `snippet: string` REQ; optional `workspace`, `title`, `score`, `created_at (string|number|null)`, `origin {kind, host?}`. Unknown keys are stripped, so full-fidelity extra fields are safe.
- **export argv**: `["export","--format",fmt,"--",path]`, fmt ∈ markdown (diary) | text (reflect/trauma). cm's failure heuristic: `=== UNKNOWN ===` ratio >0.5 and count >3 of non-empty lines → cm falls back to its own parser. **Never emit UNKNOWN role headers.**
- **timeline argv**: `["timeline","--since","<N>d","--json"]`. cm reads `groups` as `{dateKey: [{path||source_path, agent, messageCount||message_count, startTime||started_at…}]}`. `findUnprocessedSessions` is timeline-first with search fallback only when groups are empty ⇒ timeline must be a real index-free mtime enumeration.
- **stats argv**: `["stats","--json"]` — any object accepted, displayed raw by `cm doctor`.
- **Exit codes cm reacts to**: 0 success (incl. zero hits), 2 usage, 3 index-missing (NEVER emit — the shim has no index), 4 not-found, 9 unknown, 10 timeout (NEVER emit — cm's execFile owns killing). Error envelope `{"error":{code,kind,message,hint,retryable}}` on **stderr**; stdout stays data-only.
- **Agent slugs**: cm's cross-agent allowlist compares against real cass slugs — **emit `claude_code`, never `claude`**, or enrichment silently filters everything.
- **Real cass v0.6.22 output shapes to mimic**: search `--robot` envelope `{query, limit, offset:0, count, total_matches, hits, max_tokens:null, request_id:null, cursor:null, hits_clamped:false}`, pretty-printed + trailing newline; hit shape `FullHitCompat` `{title, snippet, content, score, source_path, agent, workspace, created_at (epoch ms), line_number, match_type, source_id, origin_kind}`; timeline `{range:{start,end}, total_sessions, groups:{"%Y-%m-%d %H:00": […]}}`; stats `{conversations, messages, by_agent, top_workspaces, date_range, raw_mirror, db_path}`; export markdown (`# <title>` / `*Started: %Y-%m-%d %H:%M UTC*` / `## 👤 User` / `## 🤖 Assistant` blocks separated by `---`) and text (`=== <ROLE> ===` headers); error kinds `"usage" | "not-found" | "empty-session" | "unknown"`.

### Requirements

**Compatibility process contract**

- R1. The package ships an executable `agent-session-search-cass-shim` bin whose `--version` path exits 0 within cm's 2s availability timeout without resolving roots, loading config, or starting FFF — and before heavy module imports (KTD4).
- R2. The supported surfaces are exactly `--version`, `health`, `search`, `export`, `timeline`, and `stats`; they ship together. Unsupported commands fail with exit 2 and usage guidance naming `~/.local/bin/cass` and the supported verb list. No passthrough to real cass (locked decision).
- R3. Successful commands write only their data payload to stdout. Diagnostics and failures go to stderr; structured failures use `{error:{code,kind,message,hint,retryable}}` with exit codes 2, 4, or 9 only. The shim never emits 3 or 10.
- R4. Parsing supports the exact argument forms cm uses: `--` separators, repeated `--agent`, `--fields`, `--robot`, `--days`, `--workspace`, `--since` (`7d` and documented bare positive integer), `--json`, and export formats `markdown` and `text`.
- R5. Unknown flags produce a stderr warning naming the flag and the pinned cm build, and are otherwise ignored (tolerant; KTD5). Missing values, malformed numbers/durations, and unsupported export formats are usage errors: exit 2, stderr envelope, empty stdout.

**Search behavior**

- R6. `search` calls `createSessionSearch` in-process (`src/search.ts:1796`, pattern at `src/cli.ts:609`) and never shells to the package CLI, either MCP server, or real cass. The search instance is closed in `finally` on success and error.
- R7. The predecessor plan's `days`/`workspace` fields pass straight through to the shared search input — no shim-local re-filtering. CASS agent slugs map to configured sources (`claude_code`→`claude`, `pi_agent`→`pi`); an unknown slug returns a successful zero-hit envelope without calling the backend, plus a stderr note listing accepted slugs.
- R8. Candidate-group leads flatten in group-priority then lead order, dedupe by source+canonical path keeping the first occurrence, and slice to the global `--limit` after a bounded per-source overfetch (`maxResultsPerSource`; KTD7). Every hit carries numeric `line_number` via the named constant `CASS_SHIM_DEFAULT_LINE_NUMBER = 1`, `source_path`, a cass-compatible `agent` slug, `snippet`, and a synthetic monotonic ordinal score. `workspace` is emitted only as an echo of the requested `--workspace`; otherwise omitted (KTD8). Optional fields emit only when grounded (`created_at` from stat mtimeMs, omitted on failure).
- R9. Zero hits is a successful envelope (`hits: []`, exit 0). Source/backend warnings summarize to stderr while stdout stays parseable. Total backend failure exits 9 — never a false successful empty result.

**Export and queryless enumeration**

- R10. `export` reads the requested local session file directly (with `~` expansion and a documented maximum input size) and renders cass-compatible markdown or text from bounded extractors for the known Claude (string|blocks content), Codex (rollout `payload.content[].text`), Pi, and conservative generic (`role|type` + `content|text|message`) shapes. Records without confident role+text are skipped; `=== UNKNOWN ===` is never emitted; unparsed raw records are never echoed as conversation text.
- R11. Missing export files exit 4 (`not-found`). Existing files with zero confidently parsed messages — or oversized/wholly unparseable files — exit 9 (`empty-session`) with empty stdout, so cm's own fallback parser engages.
- R12. `timeline` and `stats` share one ephemeral filesystem enumerator over `resolveSessionRoots` (`src/roots.ts:116`) + `pathMatchesInclude` (`src/roots.ts:306`) + bounded-concurrency `stat`. It preserves canonical absolute paths, never follows symlink directories, tolerates per-root/per-file failures as structured warnings, and creates no index, mirror, cache, or durable aggregate.
- R13. Timeline groups by UTC hour (`"%Y-%m-%d %H:00"`) of file mtime, sorts newest-first, caps after sorting (newest 1000), and emits `message_count: 0` deliberately (cm reads path+agent only — documented). Stats uses no cutoff, per-root cap 5000, no file-content reads, reports `messages: null` with an explicit not-computed note, discloses caps/truncation, and attaches a `shim: {name, version, engine}` marker so `cm doctor` shows which engine is live.
- R14. `health` always exits 0 with `{status:"ok", healthy:true, …, explanation:"no index; sessions searched live", shim:{…}}`. It never claims a probe it did not run.

**Architecture and release**

- R15. Neither MCP server, `search_sessions`, native policy, nor the FFF capability router changes. The existing managed and native tool-list smoke tests are release gates for this negative requirement.
- R16. `DESIGN.md` records the shim bin in the Product Contract and narrowly annotates the markdown-export Non-Goal (shim-only cm-interop adapter). User documentation covers activation via `CASS_PATH`/`cassPath`, compatibility scope, diagnostics, version-drift revalidation, and one-step rollback. `capabilities --json` lists the shim as a separate entrypoint while managed `mcp.tools` stays exactly `["search_sessions"]`.
- R17. Release acceptance is live: `cm doctor`, `cm context`, and `cm reflect --dry-run` against the built shim show shim-marked stats, schema-valid hits with canonical paths, no `degraded` field on successful search, no `UNKNOWN` export blocks, and `cm context` under 4s on the reference corpus. Unsetting `CASS_PATH` restores real cass with no config rewrite.

### Acceptance Examples

- AE1. `cm` invokes `agent-session-search-cass-shim --version`; the process exits 0 in well under 2s with one data-only stdout line, even when `fff-mcp` is absent, because version reporting initializes nothing.
- AE2. `cm context` sends `search --limit 10 --days 7 --workspace <path> --robot -- <query>`; the shim returns the real-cass envelope whose hits each pass cm's zod schema and whose paths are canonical session paths.
- AE3. `search --agent claude_code` searches only the `claude` source and emits `agent: "claude_code"`; an unsupported slug returns a valid zero-hit envelope, exit 0, a stderr note naming accepted slugs, and no broadened all-source search.
- AE4. A lead without `line` maps to `line_number: 1` (via `CASS_SHIM_DEFAULT_LINE_NUMBER`), keeping cm's whole-search parse alive.
- AE5. Exporting a mixed-validity JSONL file skips malformed and role-unknown records, renders the valid conversation in both formats, and scores zero on cm's UNKNOWN-ratio heuristic.
- AE6. Timeline over two temp roots with controlled mtimes returns UTC-hour groups newest-first, respects managed include patterns, and reports an unreadable root as a warning while keeping healthy-root sessions.
- AE7. `agent-session-search-mcp` still lists only `search_sessions`; the native server still lists only its existing diagnostic plus policy-approved namespaced FFF tools.
- AE8. Unsetting `CASS_PATH` after trials returns `cm doctor` to the real cass binary with no data migration or config rewrite.

### Scope Boundaries

**In scope**

- The six compatibility surfaces and their cass-shaped stdout/stderr/exit contracts.
- Minimal interop export extractors, and ephemeral metadata enumeration for timeline/stats.
- Package bin/files wiring, documentation, unit/contract tests, packed-install tests, and live `cm` acceptance proof.

**Deferred to follow-up work**

- A `scripts/verify-cm-contract.sh` drift detector (strings + jq assertions) — recommended as a Bead, not this branch's scope.
- Additional cass verbs/flags discovered in a later cm release.
- Additional session export formats not representable by the bounded extractors.
- Surfacing the shim marker through `agent-session-search-doctor` — Bead if wanted.
- Performance changes inside the shared FFF backend if the shim adapter is not the source of a latency miss.

**Outside this product's identity**

- Passing unknown commands through to real cass.
- Repairing, wrapping, caching, or synchronizing the cass index.
- A third MCP lane, new managed MCP tools, native policy changes, custom search, embeddings, SQLite stores, mirrors, or durable session aggregation.
- A general transcript conversion/export product surfaced through the CLI or either MCP server.

---

## Planning Contract

### Council synthesis resolutions (where the drafts diverged)

1. **Unknown flags: tolerant wins** (concept + kimi + fable over codex's fail-closed). cm is the only caller and its argv is fully pinned; real cass ignores unknown flags; hard-failing on an unrecognized flag would break cm on a benign cm upgrade. The drift guard is the stderr warning plus the documented re-verification step. Malformed _known_ values still exit 2. Codex's broadened-search concern is mitigated because every filter cm sends today is parsed explicitly.
2. **Packaging: nested `dist/cass-compat/` + one `files` line wins** (concept + codex + fable over kimi's flat output). The build is plain `tsc -p tsconfig.build.json`, which mirrors the source tree, so flat dist would force flat source names for eleven modules; `src/prototypes/` already sets the subdirectory precedent. The churn kimi avoided is one line in `package.json.files`; the failure mode it targeted is covered by a packed-install assertion on nested modules.
3. **Degraded mode: documentation-only** (codex + fable over concept's "carries a documented degraded mode"). The predecessor filter plan is a hard precondition; no shim-local stat/prefix post-filter is built or tested. One paragraph in `docs/cass-shim.md` records the fidelity loss if anyone backports the shim ahead of the filters (containment-only workspace matching misses codex/pool sessions).
4. **Pure dispatcher adopted** (codex KTD4): `src/cass-compat/run.ts` owns parse → dispatch → `{stdout, stderr, exitCode}`; the entrypoint only constructs dependencies and applies the result to process streams. Every stream/exit combination becomes contract-testable without spawning a process.
5. **Import-light entry adopted** (fable 2 + kimi 1): the entry answers `--version`/`health`/usage errors before heavy imports and loads verb modules via dynamic `import()` per dispatch — an implementation requirement, enforced by a timed packaging smoke.
6. **`workspace`: echo-or-omit** (codex KTD5 over concept/fable dash-decode). cm's schema treats `workspace` as optional; a wrong dash-decoded value is worse than none. Emit the requested `--workspace` echo when present, otherwise omit. Drops the dash-decode helpers from scope.
7. **Synthetic score kept, documented as ordinal** (concept + codex KTD6 + fable 3 agree): rank-derived descending values matching the real-cass hit shape; `docs/cass-shim.md` states they are not relevance scores and not comparable to cass's.
8. **`health` verb kept** (all drafts): cm's gate never calls it, but cm's hint text tells humans to run it; ~20 lines prevents a confusing dead end. Always-ok, no fake probes.
9. **`capabilities --json` gains one shim line** (fable 6): DESIGN.md already requires capabilities to document separate entrypoints; managed `mcp.tools` is unchanged.

### Recommended Implementation Shape

One new bin, one new module directory, zero changes to managed/native MCP surfaces:

```text
src/cass-shim.ts            #!/usr/bin/env node entry; isEntrypoint guard (src/entrypoint.ts:4);
                            import-light cheap-verb fast path (--version/health/usage errors);
                            dynamic-import dispatch to run.ts; applies result to process streams;
                            top-level catch -> cass error envelope on stderr
src/cass-compat/run.ts      pure dispatcher: argv -> typed command -> handler -> {stdout,stderr,exitCode};
                            guarantees search-instance cleanup in finally
src/cass-compat/argv.ts     cass-style parsing; `--` terminator; repeated --agent accumulation;
                            unknown flags warn on stderr and are ignored; malformed known values -> exit 2
src/cass-compat/agents.ts   cass-slug <-> source-name maps: claude_code<->claude, codex, pi_agent<->pi,
                            cursor, gemini, hermes; unmapped -> source name; accepted-slug list for stderr
src/cass-compat/search.ts   search verb: build SearchSessionsInput (candidates mode; days/workspace
                            passthrough; source restriction; per-source overfetch bound), flatten
                            CandidateGroup.leads in order, dedupe source+path keep-first, global
                            --limit slice, FullHitCompat envelope; CASS_SHIM_DEFAULT_LINE_NUMBER = 1
src/cass-compat/sessions.ts ephemeral enumerator shared by timeline/stats: resolveSessionRoots
                            (src/roots.ts:116) + pathMatchesInclude (src/roots.ts:306) + bounded stat;
                            no symlink-dir traversal; per-root warnings
src/cass-compat/export.ts   bounded read; tolerant per-format extractors; never UNKNOWN;
                            header comment: cm-interop adapter ONLY, excluded from engine per DESIGN Non-Goals
src/cass-compat/timeline.ts timeline verb over sessions.ts (--since Nd + bare int; UTC hour groups)
src/cass-compat/stats.ts    stats verb over sessions.ts (+ shim identity marker, truncation disclosure)
src/cass-compat/health.ts   always-ok health payload
src/cass-compat/errors.ts   exit codes {0,2,4,9} + stderr envelope builder
src/cass-compat/output.ts   stdout JSON writers (pretty + trailing newline, matching real cass)
```

Engine access is in-process via `createSessionSearch` exactly as `src/cli.ts:609` does, with `close?.()` in `finally`. The shim never spawns the CLI or another process (except the FFF children the engine itself owns). Version reporting uses `packageVersion()` (`src/package-info.ts:7`) only.

### Key Technical Decisions

| ID    | Decision and rationale                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KTD1  | **Compatibility frontend over the managed library, not a third lane** (session-settled: user-directed — chosen over repairing/wrapping cass: the engine already searches the same corpus index-free). Search reuses `createSessionSearch`; timeline/stats reuse only root primitives because they are queryless. Neither MCP server changes.                                             |
| KTD2  | **Predecessor filter plan is a hard precondition** (session-settled: user-directed — chosen over a shim-local degraded post-filter: one filter contract governs CLI, MCP, and shim; a duplicate post-filter could filter after per-source caps and disagree with the CLI). The degraded mode is documentation-only (synthesis resolution 3).                                             |
| KTD3  | **Pure dispatcher owns stream discipline.** Handlers return `{stdout, stderr, exitCode}` values and never touch process globals; the entrypoint is trivial. Every parse/failure path is deterministic and unit-testable.                                                                                                                                                                 |
| KTD4  | **Import-light entrypoint with cheap-verb fast path.** `--version`, `health`, and usage errors resolve before root resolution, config load, FFF preflight, or heavy imports; verb modules load via dynamic `import()`. cm's 2s spawnSync gate makes this a correctness requirement on cold Node starts, not a nicety.                                                                    |
| KTD5  | **Tolerant unknown-flag parsing, strict known-value validation.** Unknown flags warn on stderr (naming flag + pinned cm build) and are ignored; malformed values for known flags exit 2. See synthesis resolution 1 for the codex dissent and its mitigation.                                                                                                                            |
| KTD6  | **Full real-cass envelope fidelity, gated by cm's zod schema verbatim in a contract test.** Extra fields are cheap and stripped by cm; `line_number` non-nullability is the sharpest edge and is pinned by the named constant `CASS_SHIM_DEFAULT_LINE_NUMBER = 1` shared by mapping code and test.                                                                                       |
| KTD7  | **Bounded search fanout for the 8s budget.** cm's `--limit` is a post-flatten slice, not an engine bound; the shim passes a conservative `maxResultsPerSource` overfetch and forwards engine warnings to stderr, so a hanging source degrades to partial results (exit 0) instead of a cm TIMEOUT. Never caching or indexing (Non-Goal).                                                 |
| KTD8  | **`workspace` echo-or-omit; no dash-decoding.** Optional in cm's schema; an unreliable value is worse than absence (synthesis resolution 6).                                                                                                                                                                                                                                             |
| KTD9  | **Export is a narrow, written-down interop exception.** Bounded extractors for the formats cm needs; skip unknown records; exit 9 engages cm's fallback. The DESIGN.md Non-Goals annotation and the module header comment are deliverables, not polish — without them a future cleanup could delete `export.ts` citing Non-Goals.                                                        |
| KTD10 | **Ephemeral, honesty-first enumeration.** No symlink-directory traversal, bounded stat concurrency, sort newest-first before capping, caps/truncation disclosed in output, `message_count: 0` in timeline and `messages: null` in stats documented as deliberate (a future cm gating on `messageCount>0` would silently break unprocessed-session discovery — pinned in docs and tests). |
| KTD11 | **All six surfaces ship as one reversible package change.** No partial activation, no data migration; users opt in via `CASS_PATH`/`cassPath` and roll back by removing the override.                                                                                                                                                                                                    |
| KTD12 | **Nested module layout with explicit `files` entry.** `src/cass-compat/` compiles to `dist/cass-compat/`; `package.json.files` gains `"dist/cass-compat/*.js"`; packed-install tests assert nested modules are present (synthesis resolution 2).                                                                                                                                         |

### Ordered Implementation Steps

**Step 0 (precondition, order-changing):** Confirm the companion plan `docs/plans/2026-07-20-001-feat-days-workspace-filters-plan.md` is merged and `SearchSessionsInput` in `src/types.ts` carries `days`/`workspace`. (At plan time it does not.) If absent: proceed with U1, U3, and U4 only, defer U2 until rebase onto the merged predecessor, and never build the shim-local fallback filter.

One branch, three commits, no release between (locked decision):

1. **Commit A — scaffolding + cheap verbs + search (U1 + U2).**
   - `src/cass-compat/{errors,output,argv,run,agents,search,health}.ts`, `src/cass-shim.ts`.
   - `package.json`: `bin` gains `"agent-session-search-cass-shim": "dist/cass-shim.js"`; `files` gains `"dist/cass-compat/*.js"`. (`scripts/chmod-bins.mjs` picks the new bin up dynamically.)
   - Tests: `test/cass-shim-argv.test.ts`, `test/cass-shim-contract.test.ts` (cm zod schema verbatim; injected backend via the `createBackend` seam, `test/search.test.ts:66`).
2. **Commit B — export (U3).**
   - `src/cass-compat/export.ts` + fixtures `test/fixtures/cass-compat/{claude-session,codex-rollout,pi-session}.jsonl`, `messages.json`, `garbage.jsonl`.
   - `test/cass-shim-export.test.ts`: golden markdown/text outputs; UNKNOWN-heuristic zero; ENOENT→4; garbage/empty→9.
3. **Commit C — timeline + stats + packaging + docs (U4 + U5).**
   - `src/cass-compat/{sessions,timeline,stats}.ts`; `test/cass-shim-timeline.test.ts` (temp roots, `utimes`-controlled mtimes, cm groups-parse simulation).
   - `test/packaging.test.ts`: assert `dist/cass-shim.js` plus at least one `dist/cass-compat/*.js` module in the packed set; `--version` exec smoke with a wall-clock bound.
   - Docs: `DESIGN.md` Product Contract bin line + Non-Goals annotation; new `docs/cass-shim.md`; `README.md` short optional-interop section (must satisfy `test/readme.test.ts`); `CONTEXT.md` key-modules line; `src/help.ts` capabilities entrypoint line.
4. **Pre-merge: U6 live verification** (the acceptance bar) — see Verification Contract.

### Files and Modules Likely to Change

- **New runtime:** `src/cass-shim.ts`; `src/cass-compat/{run,argv,errors,output,agents,search,export,sessions,timeline,stats,health}.ts`.
- **New tests/fixtures:** `test/cass-shim-{argv,contract,export,timeline}.test.ts`; `test/fixtures/cass-compat/`.
- **Modified:** `package.json` (bin + files), `test/packaging.test.ts` (additive asserts), `DESIGN.md`, `CONTEXT.md`, `README.md`, `src/help.ts`.
- **New docs:** `docs/cass-shim.md`.
- **Consumed but unmodified:** `src/search.ts` (`createSessionSearch`), `src/roots.ts` (`resolveSessionRoots`, `pathMatchesInclude`), `src/entrypoint.ts` (`isEntrypoint`), `src/package-info.ts` (`packageVersion`), `src/types.ts` (days/workspace fields from the predecessor plan).
- **Explicitly untouched:** `src/server.ts`, `src/native-server.ts`, `src/tool.ts`, `src/fff-native-policy.ts`, `src/fff-capability-router.ts`, `src/cli.ts`, `docs/cli.md` (the shim is a separate bin, not a CLI subcommand — keeps the CLI parse-error contract and capabilities surface stable).

### Risks and Order-Changing Open Questions

| Risk or question                                                            | Impact on order                                                        | Resolution or mitigation                                                                                                                                |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Predecessor `days`/`workspace` plan not merged (true at plan time)          | Blocks U2 and all release acceptance; U1/U3/U4 may proceed             | Step 0 gate: rebase onto the merged predecessor; no shim-local duplicate filtering.                                                                     |
| A newer cm build changes argv, hit schema, or consumption heuristics        | Returns work to U1's contract fixtures before handler changes continue | Contract pinned to cm 0.2.12 (2026-07-19 build) via `strings`; re-verify on every cm upgrade; follow-up verify-script Bead.                             |
| One malformed hit degrades cm's entire search parse (zod whole-array parse) | None (gate, not order)                                                 | The contract test encodes cm's schema verbatim; every hit-field change goes through it.                                                                 |
| FFF startup/fanout misses the 4s target / 8s hard budget                    | Blocks U6 activation and release proof after functional tests pass     | Per-source overfetch bounds (KTD7), warnings to stderr, profile startup; never add an index or cache. cm degrades to TIMEOUT gracefully — soft failure. |
| Session-format drift silently drops export messages                         | None                                                                   | Tolerant extractors + golden fixtures per source format; worst case exit 9 engages cm's own parser.                                                     |
| A required session format yields no confident role/text pairs               | Blocks that format only; may block `cm reflect` acceptance             | Prefer exit 9 + cm fallback; a general parser requires a new design pass.                                                                               |
| `message_count: 0` breaks a future cm that gates on `messageCount>0`        | None today                                                             | Deliberate tradeoff, pinned in `docs/cass-shim.md` and the timeline test.                                                                               |
| Slug fidelity (`claude_code` vs `claude`) silently empties cm enrichment    | None                                                                   | Contract test (`--agent claude_code` searches only claude); stderr diagnostics list accepted slugs.                                                     |
| `files` glob omits nested dist modules                                      | Blocks U5 packed-install verification                                  | Explicit `"dist/cass-compat/*.js"` + packed-install assertion on a nested module.                                                                       |
| Successful stderr warnings interpreted as failures by a future cm           | Would require output-policy revision                                   | Current cm uses stdout + exit status; contract-test this assumption; keep routine warnings concise.                                                     |
| `created_at` semantics (mtime vs session start) differ from real cass       | None                                                                   | cm treats the field loosely; documented so nobody "fixes" it into a file-content parse.                                                                 |

---

## Implementation Units

### U1. Pin the compatibility parser, dispatcher, result model, and process boundary

- **Goal:** Establish the six supported surfaces and a fully testable stdout/stderr/exit contract before command-specific behavior.
- **Requirements:** R1–R5; AE1; KTD3, KTD4, KTD5.
- **Dependencies:** None.
- **Files:** Create `src/cass-shim.ts`, `src/cass-compat/{run,argv,errors,output,health}.ts`, `test/cass-shim-argv.test.ts`.
- **Approach:** Model parsed commands as a closed union and completion as a `{stdout, stderr, exitCode}` value. Recognize `--version` (and `health`, usage errors) before constructing operational dependencies or loading heavy modules. Centralize usage errors, error envelopes, and pretty-print + trailing-newline rules. Accept known compatibility flags (`--robot`, `--json`, `--fields`) without changing the full-fidelity output; unknown flags warn and continue; missing values, malformed numbers/durations, unsupported formats, and unsupported commands exit 2 with a hint naming `~/.local/bin/cass` and the supported verbs.
- **Patterns to follow:** `src/entrypoint.ts:4` for the executable guard, `src/package-info.ts:7` for version reporting, `src/cli.ts` for parse-error separation (without reusing its user-facing contracts).
- **Test scenarios:**
  - `--version` returns one line (`agent-session-search-cass-shim <ver> (cass-robot-compat for cm)`), exit 0, empty stderr, and never calls injected search/root dependencies.
  - Search parses the exact cm argv order, repeated `--agent`, optional `--fields`, and `--` before a query that begins with a dash.
  - Timeline accepts `--since 7d` and a bare positive integer; zero/negative/fractional/malformed durations exit 2.
  - Export accepts only `markdown`/`text`, preserves a path after `--` (including paths with spaces or a leading dash), and rejects a missing path.
  - Unknown command → one JSON error envelope on stderr, empty stdout, exit 2, supported-surface hint; unknown flag → stderr warning, command still proceeds.
  - A handler exception becomes exit 9 with no partial stdout.
- **Verification:** Every supported argv form maps to one typed command; every parse/failure path has deterministic streams and exit status.

### U2. Adapt managed search results to the cass robot contract

- **Goal:** Make `cm context` and other cm searches use the FFF-backed engine with strict-schema-compatible hits.
- **Requirements:** R6–R9, R15; AE2–AE4, AE7; KTD1, KTD2, KTD6, KTD7, KTD8.
- **Dependencies:** U1 and the merged predecessor `days`/`workspace` filter plan.
- **Files:** Create `src/cass-compat/{agents,search}.ts`, `test/cass-shim-contract.test.ts`; consume the final `SearchSessionsInput` from `src/types.ts` without adding shim-only fields.
- **Approach:** Map cass slugs to source names (`claude_code`→`claude`, `pi_agent`→`pi`; unmapped → source name). Build one candidates-mode request carrying query, `days`, `workspace`, source restriction, and a per-source overfetch bound. Flatten groups/leads in returned order, dedupe by source+path keeping first, slice to the global limit, stat each selected path once for `created_at`, and map required fields defensively (`line_number` via `CASS_SHIM_DEFAULT_LINE_NUMBER`; `title` from filename stem/sessionId; `content` = snippet; `match_type`, `source_id`, `origin_kind` = "local"). Echo a requested canonical workspace; otherwise omit `workspace`. Emit the full real-cass envelope. Always close the search instance in `finally`. Unknown slug → zero-hit envelope, exit 0, stderr note listing accepted slugs.
- **Patterns to follow:** `src/search.ts:1796` (`createSessionSearch`), the call pattern at `src/cli.ts:609`, the injected-backend `createBackend` seam at `test/search.test.ts:66`.
- **Test scenarios:**
  - cm's zod hit schema encoded verbatim is the gate; every emitted hit parses individually.
  - Multi-group results flatten deterministically; duplicate source/path leads collapse to the first occurrence; global limit applies after flatten.
  - A lead without `line` emits `line_number: 1`.
  - Repeated known agents search only their mapped sources; unknown slug returns a valid zero-hit envelope without calling the backend; envelope keys match real cass exactly.
  - `days`/`workspace` are passed to the shared search input and never re-applied after candidate caps.
  - Empty results exit 0; partial source warnings stay on stderr while valid hits stay on stdout; total backend failure exits 9.
  - The search instance closes exactly once on success, zero-hit success, and thrown failure.
  - Managed MCP tool listing remains exactly `search_sessions`; native catalog unchanged.
- **Verification:** The envelope matches the real-cass outer shape, every hit satisfies cm's schema, and all retrieval traverses `createSessionSearch` and FFF.

### U3. Implement bounded session export compatibility

- **Goal:** Supply the markdown and text exports cm needs while remaining a narrow interop adapter.
- **Requirements:** R10–R11, R15; AE5; KTD9.
- **Dependencies:** U1.
- **Files:** Create `src/cass-compat/export.ts`, `test/cass-shim-export.test.ts`, fixtures under `test/fixtures/cass-compat/`.
- **Approach:** Expand `~`, resolve the file, enforce a documented maximum input size, parse JSONL line-by-line or JSON as an array/`messages` container. Small per-format extractors: Claude content strings/blocks, Codex rollout payload content blocks, Pi records, and a conservative generic role + text/content/message fallback. Normalize only confident user/assistant/system/tool roles with non-empty text; skip everything else. Render byte-compatible cass markdown (`# <title>` / `*Started: %Y-%m-%d %H:%M UTC*` / `## 👤 User` / `## 🤖 Assistant` with `---` separators) and text (`=== <ROLE> ===`). Header comment declares cm-interop-adapter status per DESIGN Non-Goals; no exports from this module become a package API.
- **Test scenarios:**
  - Claude, Codex, and Pi fixtures render the expected ordered user/assistant text in both formats (golden outputs).
  - Content blocks concatenate deterministically; tool metadata and unknown structural records never become invented prose.
  - Malformed JSONL lines among valid records are skipped without aborting.
  - No golden output contains `=== UNKNOWN ===`; cm's UNKNOWN-ratio heuristic scores zero.
  - Missing file → exit 4; oversized/empty/wholly unparseable existing file → exit 9 with empty stdout.
- **Verification:** Golden outputs are stable, carry no unknown-role headers, and cause cm to accept the export or intentionally invoke its fallback.

### U4. Add ephemeral session enumeration, timeline, and stats

- **Goal:** Support cm's unprocessed-session discovery and diagnostics without reintroducing an index or overstating metadata accuracy.
- **Requirements:** R12–R14; AE6; KTD10.
- **Dependencies:** U1; may proceed in parallel with U2 and U3.
- **Files:** Create `src/cass-compat/{sessions,timeline,stats}.ts`, `test/cass-shim-timeline.test.ts`.
- **Approach:** Resolve roots once per command; walk entries without following symlink directories; apply `pathMatchesInclude`; canonicalize; collect stat metadata through a bounded worker pool; return records plus structured warnings rather than throwing on one bad root. Timeline: mtime cutoff from `--since`, sort newest-first, cap newest 1000 after sorting, group by UTC `"%Y-%m-%d %H:00"`, stable ids from source+canonical path, `message_count: 0` (documented). Stats: same records, no cutoff, per-root cap 5000, no file reads, per-source conversation counts, mtime date range, `messages: null` with a not-computed note, `shim: {name, version, engine}` marker, disclosed truncation.
- **Test scenarios:**
  - Included files across healthy roots return with canonical absolute paths; excluded files, out-of-root files, and symlink-directory descendants are absent.
  - One unreadable root yields a warning while healthy-root records remain; all roots failed exits 9.
  - Controlled mtimes at UTC hour boundaries group correctly; groups and sessions order newest-first; `--since 7d` excludes older files; caps apply only after global sorting and are disclosed.
  - Stats counts match the enumerated fixture set; date range is deterministic; truncation prevents an exactness claim.
  - A simulation of cm's groups-parse extracts non-empty canonical session paths (feeds `findUnprocessedSessions`).
- **Verification:** cm's timeline parser obtains non-empty canonical session paths; stats/health clearly distinguish exact, unavailable, and truncated fields.

### U5. Package and document the compatibility entrypoint

- **Goal:** Make the complete shim installable, discoverable, and reversible while preserving both MCP contracts.
- **Requirements:** R2, R15–R16; AE7–AE8; KTD11, KTD12.
- **Dependencies:** U2–U4.
- **Files:** Modify `package.json`, `DESIGN.md`, `CONTEXT.md`, `README.md`, `src/help.ts`, `test/packaging.test.ts`; create `docs/cass-shim.md`.
- **Approach:** Add the bin entry and `"dist/cass-compat/*.js"` to `files` (commit A). `docs/cass-shim.md` documents: supported verbs and flags, argv/JSON reference, slug mapping table, synthetic-score caveat, `message_count: 0` caveat, workspace echo-or-omit semantics, the export exception, the pinned cm/cass versions and the re-verification step on cm upgrades, the documentation-only degraded-mode note, activation via `CASS_PATH`/`cassPath`, and one-step rollback. `DESIGN.md` gains the shim bin line in the Product Contract and annotates the markdown-export Non-Goal (shim-only cm-interop adapter). `README.md` gains a short optional-interop section consistent with `test/readme.test.ts`. `src/help.ts` capabilities output lists the shim as a separate entrypoint; managed `mcp.tools` stays `["search_sessions"]`.
- **Test scenarios:**
  - `npm run build` produces executable `dist/cass-shim.js` plus nested `dist/cass-compat/*.js` modules.
  - `npm pack` includes the entrypoint, at least one nested compat module, and `docs/cass-shim.md`; excludes tests and fixtures.
  - The installed bin answers `--version` (timed, <2s), rejects an unknown verb with exit 2, and resolves its nested imports outside the repository.
  - README/docs name the shim as optional cm interoperability and still name `search_sessions` as the only managed MCP tool.
  - Installed managed and native MCP binaries list the same tools as before this work.
- **Verification:** A clean packed installation invokes the shim, reads its docs, and rolls back without modifying session data or package configuration.

### U6. Prove live cm compatibility, latency, and rollback

- **Goal:** Demonstrate that green unit tests correspond to the actual installed consumer and live corpus.
- **Requirements:** R17; AE1–AE8.
- **Dependencies:** U5.
- **Files:** At most a narrowly scoped built-binary process test (e.g. extend `test/packaging.test.ts`); no new production module unless acceptance exposes a defect.
- **Approach:** Run built-binary smokes first, then point only the acceptance commands' environment at the shim via `CASS_PATH`. Validate outputs with `jq`, the copied cm schema, canonical-root checks, and the UNKNOWN heuristic. Exercise `cm doctor`, `cm context`, and `cm reflect --dry-run` against real session files. Measure at least one cold and three warm `cm context` calls; each must stay under 4s (8s hard). Confirm no orphaned `fff-mcp` processes remain. Finish by unsetting `CASS_PATH` and proving real cass is restored. Treat live consumer behavior as the acceptance authority; do not activate the shim persistently until every gate passes.
- **Test scenarios:** see Verification Contract below.
- **Verification:** The installed consumer, live corpus, process lifecycle, latency, and rollback path all satisfy the compatibility contract.

---

## Verification Contract

### Automated gates

```bash
npm run check && npm test && npm run build
npx vitest run test/cass-shim-argv.test.ts test/cass-shim-contract.test.ts \
  test/cass-shim-export.test.ts test/cass-shim-timeline.test.ts
npx vitest run test/packaging.test.ts test/readme.test.ts \
  test/mcp-smoke.test.ts test/native-mcp-smoke.test.ts
npm run smoke
```

### Built-binary and live-corpus gates

```bash
dist/cass-shim.js --version                                     # exit 0, <2s, data-only stdout
dist/cass-shim.js search --limit 5 --days 7 --robot -- "vitest" # every hit passes cm's schema (jq)
dist/cass-shim.js search --agent claude_code --limit 5 --robot -- "vitest"   # claude source only
dist/cass-shim.js search --agent bogus --robot -- "vitest"      # hits: [], exit 0, stderr note
dist/cass-shim.js timeline --since 7d --json | jq '.groups | keys'   # UTC hour buckets
dist/cass-shim.js stats --json | jq '.shim'                     # shim identity marker
dist/cass-shim.js export --format text -- <real claude .jsonl> | grep -c "=== UNKNOWN ==="   # 0
dist/cass-shim.js bogusverb; echo $?                            # 2, envelope on stderr, stdout empty
```

For the search smoke, validate each hit against the copied cm schema and verify every `source_path` is canonical and inside its source root.

### End-to-end acceptance (the real bar)

```bash
CASS_PATH=$PWD/dist/cass-shim.js cm doctor                      # cass available; shim-marked stats
CASS_PATH=$PWD/dist/cass-shim.js cm context "recent work" --json    # history entries; NO `degraded` field
CASS_PATH=$PWD/dist/cass-shim.js cm reflect --dry-run --days 1      # >=1 session processed; no export fallback
time CASS_PATH=$PWD/dist/cass-shim.js cm context "recent work" --json   # <4s target, 8s hard
unset CASS_PATH; cm doctor                                      # rollback: real cass again, config untouched
```

---

## Definition of Done

- All six compatibility surfaces are implemented and documented; no partial surface is released.
- The predecessor `days`/`workspace` contract is merged and consumed directly, with no duplicate shim-side filter.
- Every robot-search hit passes cm's schema verbatim, including numeric `line_number` via `CASS_SHIM_DEFAULT_LINE_NUMBER`.
- Export fixtures and live exports contain no unknown-role headers; missing and unparseable sessions trigger the intended exit 4/9 fallbacks.
- Timeline and stats use only ephemeral root enumeration, preserve canonical paths, disclose caps/truncation, and create no index, mirror, or cache.
- Packed installation includes and executes the new bin and nested modules; `--version` is timed under 2s.
- Managed and native MCP tool catalogs are unchanged (smoke gates green).
- Targeted tests, full tests, typecheck, build, smoke, live cm acceptance, latency, child cleanup, and rollback proofs all pass.
- Documentation records the pinned cm/cass versions, re-verification step, caveats (synthetic score, `message_count: 0`, workspace echo-or-omit), and activation/rollback.
- The final diff contains no abandoned parser experiments, cass passthrough code, custom index, or unrelated refactor.

---

## Sources and Research

- `docs/plans/2026-07-20-001-feat-cass-compat-shim-plan.md` — resolved concept; evidence-pinned cm/cass contract (cm bundle `strings` extraction; cass v0.6.22 Rust source citations).
- `docs/plans/2026-07-20-001-feat-days-workspace-filters-plan.md` — required predecessor filter contract (hard precondition, KTD2).
- Council drafts synthesized here: `docs/investigations/cm-decoupling/plan-council-cass-shim/draft-kimi-k3.md`, `draft-codex-56-sol-x-high.md`, `draft-fable.md`. Divergences resolved in "Council synthesis resolutions".
- `DESIGN.md`, `CONTEXT.md`, `docs/adr/0001-fff-core-and-native-policy-strictness.md` — FFF-as-core, two-lane MCP boundary, canonical-path, and no-index constraints.
- Verified repo anchors: `src/search.ts:1796` (`createSessionSearch`), `src/cli.ts:609` (call pattern), `src/entrypoint.ts:4` (`isEntrypoint`), `src/roots.ts:116`/`:306` (`resolveSessionRoots`, `pathMatchesInclude`), `src/package-info.ts:7` (`packageVersion`), `test/search.test.ts:66` (`createBackend` seam), `package.json` (`bin` map of four, `files` non-recursive `dist/*.js` glob, `tsc -p tsconfig.build.json` build).
- Local verification on 2026-07-20 (codex draft): cm 0.2.12, cass 0.6.22, strict numeric `line_number` consumer schema, `--version` availability check, exact argv forms, and a live `checkpoint_incomplete` cass robot-search failure.
