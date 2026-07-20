---
title: "feat: cass-compatible shim bin (agent-session-search-cass-shim) for cass-memory"
type: feat
date: 2026-07-20
status: superseded
author: claude-fable-5 planning session (design agents; contracts pinned from cm binary + cass v0.6.22 Rust source)
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
origin: cm-decoupling initiative — companion to 2026-07-20-001-feat-days-workspace-filters-plan.md (this plan consumes its days/workspace input fields; ships second)
---

# feat: cass-compatible shim bin (`agent-session-search-cass-shim`)

## Context

cass-memory (`cm`) shells out to the `cass` binary (path from `~/.cass-memory/config.json` `cassPath` or `CASS_PATH` env) for six operations: availability check, search, export, timeline, stats, and (indirectly) unprocessed-session discovery. cass's index is structurally unreliable on this machine (livelocked incremental, partial-index loops, daily_stats OOM — upstream #329 open). This plan ships a drop-in cass-CLI-compatible bin backed by this package's index-free engine, so `cm context` and `cm reflect` work regardless of cass index health. User decisions locked: full six-verb coverage in one pass; unknown verbs error with guidance (no passthrough to real cass). Depends on the companion `--days`/`--workspace` filters plan; carries a documented degraded mode if ever run standalone.

New bin cm's `cassPath` config (or `CASS_PATH` env) points at, replacing the real indexed `cass` binary for cm's six call sites. In-process engine via `createSessionSearch` (pattern `src/cli.ts:606-611`), never shelling to the CLI. **No MCP changes — managed surface stays exactly `search_sessions`.**

### Evidence-pinned consumption contract (from `strings ~/.local/bin/cm` bundle, saved to scratchpad `cm-strings.txt`; re-verify on cm upgrades)

- **Availability gate is `[cassPath, "--version"]`** via spawnSync, 2s timeout, exit-0-only check — NOT `cass health` (those strings are just suggested-fix text). Shim must answer `--version` fast.
- **search argv**: `["search", ("--limit",N)?, ("--days",N)?, ("--agent",slug)*, ("--workspace",w)?, ("--fields",csv)?, "--robot", "--", query]`. cm sends: context `{limit:10, days:7, workspace?, timeout:8}` — **8-second wall-clock budget**; related `{limit:5, days:7}`; trauma `{days:30, limit:50}`.
- **cm's acceptance schema (zod, every hit `.parse`d — one bad hit degrades the whole search)**: `source_path: string` REQ; **`line_number: number` REQ, NOT nullable — always emit a number (fallback 1)**; `agent: string` REQ; `snippet: string` REQ; optional `workspace`, `title`, `score`, `created_at (string|number|null)`, `origin {kind, host?}`. Unknown keys stripped → full-fidelity extra fields are safe.
- **export argv**: `["export","--format",fmt,"--",path]`, fmt ∈ markdown (diary) | text (reflect/trauma). Failure heuristic: `=== UNKNOWN ===` count ratio >0.5 ∧ count >3 of non-empty lines → cm falls back to its own parser. **Never emit UNKNOWN role headers.**
- **timeline argv**: `["timeline","--since","<N>d","--json"]` (N=7 default, 365 for privacy status). cm reads `groups` as `{dateKey: [{path||source_path, agent, messageCount||message_count, startTime||started_at…}]}`. `findUnprocessedSessions` = timeline-first, search-fallback only when groups empty ⇒ timeline must be a real index-free mtime enumeration.
- **stats argv**: `["stats","--json"]` — any object accepted, displayed raw by `cm doctor`.
- **Exit codes cm reacts to**: 0 success (incl. zero hits), 2 usage, 3 index-missing (NEVER emit — shim has no index), 4 not-found (search→`[]`, export→fallback), 9 unknown, 10 timeout (never emit; cm's execFile does the killing). Error envelope `{"error":{code,kind,message,hint,retryable}}` on **stderr**; stdout stays data-only (matches real cass `main.rs` fatal path).
- **Agent slugs**: cm's cross-agent allowlist compares against real cass slugs — **emit `claude_code`, not `claude`**, or enrichment silently filters everything.

### Real cass v0.6.22 output shapes (from Rust source in scratchpad clone; mimic these)

- `search --robot` envelope: `{query, limit, offset:0, count, total_matches, hits, max_tokens:null, request_id:null, cursor:null, hits_clamped:false}`, pretty-printed + trailing newline (`src/lib.rs:25646-25668`). Hit: `{title, snippet, content, score, source_path, agent, workspace, created_at (epoch ms), line_number, match_type, source_id, origin_kind}` (`FullHitCompat` lib.rs:25595-25630).
- `timeline --json`: `{range:{start,end}, total_sessions, groups:{"%Y-%m-%d %H:00": [{id, agent, title, started_at(ms), ended_at, source_path, message_count, source_id, origin_kind, origin_host}]}}` (lib.rs:93273-93325).
- `stats --json`: `{conversations, messages, by_agent:[{agent,count}], top_workspaces, date_range:{oldest,newest}, raw_mirror, db_path}` (lib.rs:~26700).
- export markdown: `# <title>`, `*Started: %Y-%m-%d %H:%M UTC*`, `---`, `## 👤 User`/`## 🤖 Assistant` blocks each followed by `---` (lib.rs:92399-92484); text: `=== <ROLE> ===` headers (:92487-92520).
- Error kinds vocabulary: `"usage"`, `"not-found"`, `"empty-session"`, `"unknown"` (`src/model/cli_error_kind.rs:59-156`).

### Key decisions

1. **All six verbs, one branch, three commits**: (a) scaffolding + `--version` + `health` + `search`; (b) `export`; (c) `timeline` + `stats`. No release between.
2. **Full-fidelity output, cm-schema acceptance gate**: emit the complete real-cass shape (cheap, pinned above); encode cm's zod hit schema verbatim in a vitest contract test as the gate.
3. **Search mapping**: candidates mode; flatten `CandidateGroup.leads` in group-priority order, dedupe by path (keep first), filter (days/agent/workspace), slice to `--limit`. Unknown agent slug → `hits: []`, exit 0, stderr note.
4. **Exit codes**: 0/2/4/9 only; never 3 or 10. Envelope on stderr.
5. **`--version` prints honestly**: `agent-session-search-cass-shim <ver> (cass-robot-compat for cm)` — cm checks exit status only.
6. **No passthrough** (user decision): unknown verb → exit 2 usage envelope, hint names `~/.local/bin/cass` and the supported verb list.

### Module layout (`files` in package.json needs `"dist/cass-compat/*.js"` added)

```
src/cass-shim.ts            entry (#!, isEntrypoint guard, verb dispatch, top-level catch → envelope)
src/cass-compat/argv.ts     cass-style parsing; tolerant (unknown flags warn on stderr, never fail); `--` handling
src/cass-compat/agents.ts   slug↔source maps + claude dash-decode: claude_code↔claude, codex↔codex,
                            pi_agent↔pi, cursor↔cursor, gemini↔gemini, hermes↔hermes; unmapped → source name
src/cass-compat/search.ts   search verb (input build, flatten/dedupe/filter/slice, envelope shaping)
src/cass-compat/sessions.ts index-free walker shared by timeline/stats: resolveSessionRoots +
                            pathMatchesInclude (src/roots.ts exports) + stat
src/cass-compat/timeline.ts / stats.ts / health.ts / export.ts / errors.ts / output.ts
```

`export.ts` header comment: cm-interop adapter ONLY, excluded from search engine per DESIGN Non-Goals.

### Per-verb essentials

- **search**: hit derivation — `source_path`=lead.path; `line_number`=lead.line ?? 1; `agent`=slugForSource; `snippet`=lead.preview; `title`=filename stem/sessionId; `score`=rank-derived descending (`1 - i*0.05` floor 0); `workspace`= claude dash-decode of parent dir else `dirname(path)`; `created_at`=stat mtimeMs (omit on failure); `source_id`/`origin_kind`="local". Days/workspace: consume Plan A's input fields; keep shim-side stat/prefix post-filter as degraded mode if shipped first. Engine warnings → stderr.
- **export**: resolve `~`, ENOENT → exit 4 "not-found". Tolerant line walker for claude (`message.content` string|blocks), codex rollout (`payload.content[].text`), pi/generic (`role|type` + `content|text|message`); skip unparseable lines; **skip records without confident role+text (never UNKNOWN)**; zero messages → exit 9 "empty-session" (cm falls back gracefully). Byte-compatible markdown/text renderers per shapes above.
- **timeline**: `--since Nd` (tolerate bare int); walk roots, mtime cutoff, cap newest 1000; group by `%Y-%m-%d %H:00` UTC of mtime; `message_count: 0` deliberate (cm only reads path+agent here) — document.
- **stats**: same walker, no cutoff, per-root cap 5000, no file reads; include `shim: {name, version, engine}` marker so `cm doctor` shows which engine is live.
- **health**: always `{status:"ok", healthy:true, …, explanation:"no index; sessions searched live", shim:{…}}`, exit 0.

### Tests

- `test/cass-shim-contract.test.ts` — cm's zod hit schema verbatim as gate; injected backend via `createBackend` seam (`test/search.test.ts:2716` pattern); assert envelope keys, `line_number` numeric when lead.line undefined, zero-hits exit 0, `--agent claude_code` → only claude source searched, unknown slug → `[]` exit 0.
- `test/cass-shim-argv.test.ts` — argv table incl. `--`, repeated `--agent`, missing query → code-2 stderr envelope, stdout empty.
- `test/cass-shim-export.test.ts` — fixtures `test/fixtures/cass-compat/{claude-session,codex-rollout,pi-session}.jsonl`, `messages.json`, `garbage.jsonl`; golden outputs; assert cm's UNKNOWN heuristic yields zero; ENOENT→4; garbage→9.
- `test/cass-shim-timeline.test.ts` — temp roots + controlled mtimes; grouping keys, cutoff, slugs; simulate cm's groups-parse against output.
- `test/packaging.test.ts` — bin loop is dynamic (no edit); add asserts: `dist/cass-shim.js` + one `dist/cass-compat/` file in installed set; `--version` exec smoke.

### Docs

- DESIGN.md Product Contract: add the shim bin line; Non-Goals: annotate markdown-export bullet (shim-only interop adapter, not engine/CLI/MCP surface).
- New `docs/cass-shim.md`: verbs, argv/JSON reference, mapping tables, degraded-mode notes, activation/rollback runbook.

### Plan B verification contract (beyond green tests)

- `npm run check && npm test && npm run build`.
- **Direct smokes** against the live corpus: `dist/cass-shim.js --version` (exit 0, <2s); `search --limit 5 --days 7 --robot -- "vitest"` → hits validate against cm's schema by jq inspection; `timeline --since 7d --json | jq '.groups | keys'` shows hour-bucketed keys; `export --format text -- <real claude .jsonl>` → `grep -c "=== UNKNOWN ==="` is 0.
- **End-to-end with real cm** (the acceptance bar): `CASS_PATH=$PWD/dist/cass-shim.js cm doctor` shows cass available with shim-marked stats; `CASS_PATH=… cm context "recent work" --json` returns history entries with paths under real session roots and **no `degraded` field**; `CASS_PATH=… cm reflect --dry-run --days 1` processes ≥1 session without triggering the export-failure fallback.
- **Latency proof**: `time` the cm context call — must fit cm's 8s budget with margin (<4s target on this corpus).
- **Rollback proof**: unset `CASS_PATH` → `cm doctor` shows real cass again (config untouched during trials).

### Risks

cm version drift (contract pinned to 2026-07-19 build; re-verify via `strings` on upgrade); `line_number` nullability is the sharpest edge (contract test guards); session-format drift (walker tolerant; worst case exit 9 → cm's own fallback); 8s budget on huge roots (cm degrades to TIMEOUT gracefully); workspace fidelity pre-Plan-A (degraded mode documented).
