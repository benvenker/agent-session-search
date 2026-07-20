---
title: "Plan council draft (kimi-k3): cass-compatible shim bin"
author: kimi-k3
date: 2026-07-20
concept: docs/plans/2026-07-20-001-feat-cass-compat-shim-plan.md
companion: docs/plans/2026-07-20-001-feat-days-workspace-filters-plan.md
---

# Plan council draft — kimi-k3: `agent-session-search-cass-shim`

## Concept intent

cass-memory (`cm`) shells out to a `cass` binary for six operations (`--version`
gate, `search`, `export`, `timeline`, `stats`, and timeline-driven
unprocessed-session discovery). cass's index is structurally unreliable on this
machine (incremental livelock, partial-index loops, daily_stats OOM; upstream
#329 open). This package already has an index-free engine that searches the
same corpus. The concept: ship a fifth bin, `agent-session-search-cass-shim`,
that is CLI-compatible with the six cass verbs cm actually calls, backed
in-process by `createSessionSearch`, so `cm context` / `cm reflect` / `cm doctor`
work regardless of cass index health. cm selects the binary via
`~/.cass-memory/config.json` `cassPath` or the `CASS_PATH` env var — no cm
changes, no MCP surface changes.

This is a cm-interop adapter. It must not leak into the managed MCP surface
(stays exactly `search_sessions`), the native lane, or the core engine. The
markdown/text export renderers exist only to satisfy cm's export consumption
and stay inside the shim module; DESIGN.md's "no markdown exports" non-goal
gets an annotation, not a removal.

## Position on the concept doc

The concept document is already implementation-ready and unusually well pinned
(cm's zod schema from `strings` extraction, real cass v0.6.22 output shapes
from Rust source, exact argv layouts, exit-code vocabulary). I accept its
contract as the baseline. Below I (a) restate the implementation in
dependency order with verified attach points in this repo, (b) sharpen a few
points the concept leaves soft, and (c) flag the places where I would deviate
or where a decision could still flip ordering.

### Sharpenings / disagreements preserved

1. **`--version` must not initialize the engine.** cm's availability gate is
   `spawnSync([cassPath, "--version"])` with a **2s timeout, exit-0-only**.
   The shim's `--version`, `health`, and usage-error paths must return before
   any root resolution or FFF child work — no `ensureFffMcpCompatible`, no
   config load beyond reading `packageVersion()`. The concept implies this
   ("answer `--version` fast") but does not name the failure mode: the CLI
   pattern at `src/cli.ts:606-611` runs a compatibility preflight _before_
   `createSessionSearch`; copying that shape into the shim's version path would
   intermittently blow the 2s gate on cold start. Dispatch cheap verbs first.
2. **Search latency budget needs an explicit design answer, not just a
   verification step.** cm context allows 8s wall-clock. The concept's Plan B
   targets <4s on this corpus, but the shim should also _cap its own work_:
   pass conservative `maxResultsPerSource` internally (cm's `--limit` is a
   post-flatten slice, not an engine bound) and forward engine warnings to
   stderr so a hanging source degrades to partial results instead of timeout.
   Partial results + stderr note beats exit non-zero, because cm parses any
   exit-0 stdout and zod-degrades the whole search on one bad hit — but
   tolerates zero hits cleanly.
3. **`line_number: 1` fallback is the sharpest contract edge** (cm's zod
   requires a number, non-nullable). Make it a named constant with a comment
   (`CASS_SHIM_DEFAULT_LINE_NUMBER = 1`) so the contract test and the mapping
   code cannot drift apart.
4. **Packaging: `files` uses `dist/*.js`, not `dist/**/_.js`.** The concept
correctly notes adding `"dist/cass-compat/_.js"`. I would instead keep the
shim flat — `dist/cass-shim.js`+`dist/cass-shim-_.js`siblings — so the
existing`dist/_.js`glob covers it with **zero package.json`files`changes**. Fewer published-artifact failure modes, same testability. (The
bin loop in`test/packaging.test.ts`is dynamic; only an explicit assertion
for`dist/cass-shim.js` is needed.) Minor point; either is fine, but flat
   is strictly less churn.
5. **Unknown agent slug: `[]` + exit 0 + stderr note is right**, but also log
   the _accepted_ slug list to stderr. cm's cross-agent allowlist silently
   filters mismatches (`claude` vs `claude_code`); when a human debugs "cm
   returns nothing", the stderr note is the only breadcrumb.

## Recommended implementation shape

One new bin registered in `package.json` `"bin"` as
`agent-session-search-cass-shim -> dist/cass-shim.js`. All new code lives in
`src/cass-compat/` (flat output under `dist/` per sharpening 4). No changes to
`src/server.ts`, `src/native-server.ts`, `src/tool.ts`, or the MCP surface.
The shim consumes the days/workspace input fields added by the companion plan
(`2026-07-20-001-feat-days-workspace-filters-plan.md`), which ships first;
the shim carries a stat/prefix post-filter as documented degraded mode only if
that ordering is ever inverted.

```text
src/cass-shim.ts            bin entry: shebang, isEntrypoint guard (src/entrypoint.ts:4),
                            cheap-verb fast path (--version/health), verb dispatch,
                            top-level catch -> cass error envelope on stderr, exit code
src/cass-compat/argv.ts     tolerant cass-style parsing; `--` terminator; repeated
                            --agent accumulation; unknown flags warn on stderr, never fail
src/cass-compat/agents.ts   cass-slug <-> source-name maps incl. claude_code<->claude,
                            codex, pi_agent<->pi, cursor, gemini, hermes; unmapped -> source name
src/cass-compat/search.ts   search verb: build SearchSessionsInput (days/workspace passthrough,
                            candidates mode), flatten CandidateGroup.leads in group order,
                            dedupe by path (keep first), slice to --limit, shape FullHitCompat
src/cass-compat/sessions.ts index-free walker for timeline/stats: resolveSessionRoots
                            (src/roots.ts:116) + pathMatchesInclude (src/roots.ts:306) + stat
src/cass-compat/export.ts   transcript renderer: tolerant line walkers (claude string|blocks,
                            codex rollout payload.content[].text, pi/generic role|type +
                            content|text|message); never emit UNKNOWN; cm-interop adapter ONLY
src/cass-compat/timeline.ts timeline verb over sessions.ts walker
src/cass-compat/stats.ts    stats verb over sessions.ts walker (+ shim identity marker)
src/cass-compat/health.ts   always-ok health payload
src/cass-compat/errors.ts   exit codes {0,2,4,9} + stderr envelope builder
src/cass-compat/output.ts   stdout JSON writers (pretty + trailing newline, matching real cass)
```

Engine access is in-process via `createSessionSearch` (`src/search.ts:1796`)
exactly as `src/cli.ts:609` does, with `close?.()` in `finally`. Never spawn
the CLI or another process from the shim (except the FFF children the engine
itself owns).

### Per-verb contract recap (what the code must satisfy)

- `--version`: `agent-session-search-cass-shim <ver> (cass-robot-compat for cm)`, exit 0, <2s, no engine init.
- `search --robot`: envelope `{query, limit, offset:0, count, total_matches, hits, max_tokens:null, request_id:null, cursor:null, hits_clamped:false}`, pretty-printed + trailing newline. Hit shape `FullHitCompat`: `{title, snippet, content, score, source_path, agent, workspace, created_at(epoch ms), line_number, match_type, source_id, origin_kind}`. `line_number = lead.line ?? 1`. `agent` uses cass slugs (`claude_code`, never `claude`). Exit 0 on zero hits. Never exit 3 or 10.
- `export --format markdown|text -- <path>`: `~` expansion; ENOENT → exit 4 `not-found`; unparseable lines skipped; records without confident role+text dropped (never `UNKNOWN`); zero messages → exit 9 `empty-session`. Byte-compatible with real cass renderers (`# <title>` / `*Started: … UTC*` / `## 👤 User` / `## 🤖 Assistant` + `---`; text `=== <ROLE> ===`).
- `timeline --since <N>d --json` (tolerate bare int): real mtime enumeration, newest-1000 cap, groups keyed `"%Y-%m-%d %H:00"` UTC; entries carry `source_path`, `agent`, `started_at` (ms), `message_count: 0` (deliberate — cm reads path+agent only here; document it).
- `stats --json`: same walker, no cutoff, per-root cap 5000, no file reads; include `shim: {name, version, engine}` so `cm doctor` shows which engine is live.
- `health`: `{status:"ok", healthy:true, explanation:"no index; sessions searched live", shim:{…}}`, exit 0.
- Unknown verb: exit 2 usage envelope `{"error":{code,kind:"usage",message,hint,retryable}}` on stderr; hint names `~/.local/bin/cass` and the supported verb list. No passthrough (locked decision).

## Ordered implementation steps

Three commits on one branch, no release between (locked decision). Land the
companion days/workspace plan first; rebase this branch onto it before step 2.

1. **Commit A — scaffolding + cheap verbs + search.**
   - `package.json`: add bin entry `agent-session-search-cass-shim`.
   - `src/cass-compat/errors.ts`, `output.ts`, `argv.ts`, `agents.ts` (pure, unit-testable first).
   - `src/cass-shim.ts` with fast-path dispatch: `--version`/`health`/usage errors return before any engine touch.
   - `src/cass-compat/search.ts` consuming `createSessionSearch` with days/workspace passthrough and the FullHitCompat mapping (`CASS_SHIM_DEFAULT_LINE_NUMBER` constant).
   - Tests: `test/cass-shim-argv.test.ts`, `test/cass-shim-contract.test.ts` (cm zod schema verbatim; injected backend via the `createBackend` seam, `test/search.test.ts:66` pattern).
2. **Commit B — export.**
   - `src/cass-compat/export.ts` + fixtures `test/fixtures/cass-compat/{claude-session,codex-rollout,pi-session}.jsonl`, `messages.json`, `garbage.jsonl`.
   - Golden markdown/text outputs; assert `=== UNKNOWN ===` count is 0; ENOENT→4; garbage→9.
   - Header comment: cm-interop adapter only, excluded from engine per DESIGN non-goals.
3. **Commit C — timeline + stats + packaging/docs.**
   - `src/cass-compat/sessions.ts`, `timeline.ts`, `stats.ts`.
   - `test/cass-shim-timeline.test.ts` (tmp roots + `utimes`-controlled mtimes; simulate cm's groups-parse).
   - `test/packaging.test.ts`: assert `dist/cass-shim.js` and shim modules present in installed set; `--version` exec smoke.
   - `DESIGN.md`: Product Contract gains the shim bin line; Non-Goals annotates the markdown-export bullet (shim-only adapter).
   - New `docs/cass-shim.md`: verbs, argv/JSON reference, slug/mapping tables, degraded-mode notes, activation (`CASS_PATH`/`cassPath`) and rollback runbook.

## Files/modules likely to change

- New: `src/cass-shim.ts`, `src/cass-compat/{argv,agents,search,sessions,timeline,stats,health,export,errors,output}.ts`.
- New tests: `test/cass-shim-contract.test.ts`, `test/cass-shim-argv.test.ts`, `test/cass-shim-export.test.ts`, `test/cass-shim-timeline.test.ts`; fixtures under `test/fixtures/cass-compat/`.
- Modified: `package.json` (`bin`; `files` only if not keeping shim output flat), `test/packaging.test.ts` (additive asserts), `DESIGN.md` (contract line + non-goal annotation), `docs/cass-shim.md` (new).
- Consumed but unmodified: `src/search.ts` (`createSessionSearch`), `src/roots.ts` (`resolveSessionRoots`, `pathMatchesInclude`), `src/entrypoint.ts` (`isEntrypoint`), `src/types.ts` (days/workspace fields from companion plan).
- Explicitly untouched: `src/server.ts`, `src/native-server.ts`, `src/tool.ts`, `src/fff-native-policy.ts`, `src/cli.ts` (shim is a separate bin, not a CLI subcommand — keeps parse-error contract and capabilities surface stable).

## Tests and validation commands

Unit/contract:

- `npm run check && npm test && npm run build`
- `npx vitest run test/cass-shim-contract.test.ts test/cass-shim-argv.test.ts test/cass-shim-export.test.ts test/cass-shim-timeline.test.ts test/packaging.test.ts`

Direct smokes against the live corpus:

```bash
dist/cass-shim.js --version                                   # exit 0, <2s
dist/cass-shim.js search --limit 5 --days 7 --robot -- "vitest"   # hits pass cm zod schema (jq check)
dist/cass-shim.js timeline --since 7d --json | jq '.groups | keys'  # hour-bucketed keys
dist/cass-shim.js export --format text -- <real claude .jsonl> | grep -c "=== UNKNOWN ==="   # 0
dist/cass-shim.js stats --json | jq '.shim'                   # shim identity marker
dist/cass-shim.js bogusverb; echo $?                          # 2, envelope on stderr, stdout empty
```

End-to-end acceptance (the real bar):

```bash
CASS_PATH=$PWD/dist/cass-shim.js cm doctor                     # cass available; shim-marked stats
CASS_PATH=$PWD/dist/cass-shim.js cm context "recent work" --json   # history entries, no `degraded` field
CASS_PATH=$PWD/dist/cass-shim.js cm reflect --dry-run --days 1     # >=1 session processed, no export fallback
time CASS_PATH=$PWD/dist/cass-shim.js cm context "recent work" --json   # <4s target (8s budget)
unset CASS_PATH; cm doctor                                     # rollback: real cass again
```

## Risks, constraints, and open questions

- **Ordering constraint**: the shim's days/workspace fidelity depends on the
  companion plan landing first. If the shim must ship first, the degraded
  post-filter (stat mtime + workspace path-prefix match) applies — document
  that workspace prefix matching is _containment-only_ in degraded mode (no
  dash-encoded segment lane, no metadata lane), so codex/pool sessions can be
  missed. This would change review scope of commit A; keep the ordering.
- **cm version drift**: the contract is pinned to the 2026-07-19 cm build via
  `strings` extraction. Any cm upgrade requires re-verifying the argv layouts,
  the zod hit schema, and the export-failure heuristic. Open question: should
  a `scripts/verify-cm-contract.sh` (strings + jq assertions) be added so
  drift is detectable in CI rather than by hand? Recommend yes as a
  follow-up bead, not in this branch's scope.
- **8s wall-clock budget**: on much larger corpora the live-grep search can
  exceed it; cm degrades to TIMEOUT gracefully, but the shim should internally
  bound `maxResultsPerSource` and forward warnings to stderr (sharpening 2).
  If live smokes miss the <4s target, the mitigation is engine-side caps, not
  caching or indexing (non-goal).
- **zod whole-search degradation**: one malformed hit voids cm's entire
  search parse. The contract test with cm's schema verbatim is the gate; any
  future hit-field change must go through it.
- **Session-format drift in export**: the tolerant walker skips unparseable
  lines; worst case exit 9 triggers cm's own parser fallback — acceptable,
  but golden fixtures must cover each built-in source's real format
  (claude blocks, codex rollout, pi/generic) to catch silent drops.
- **`message_count: 0` in timeline** is a deliberate fidelity tradeoff (cm
  reads path+agent only). If a future cm version gates on `messageCount>0`,
  this silently breaks unprocessed-session discovery — pin a note in
  `docs/cass-shim.md` and the timeline test.
- **Slug fidelity**: `claude_code` vs `claude` silently empties enrichment.
  Covered by contract test (`--agent claude_code` searches only the claude
  source); keep stderr diagnostics loud.
