---
title: "Plan council draft (fable): cass-compatible shim bin (agent-session-search-cass-shim)"
author: fable
date: 2026-07-20
status: council-draft
concept: docs/plans/2026-07-20-001-feat-cass-compat-shim-plan.md
companion: docs/plans/2026-07-20-001-feat-days-workspace-filters-plan.md
---

# Council draft — cass-compat shim bin (`agent-session-search-cass-shim`)

## 1. Concept intent

Ship a drop-in, cass-CLI-compatible binary backed by this package's index-free
grep engine so that cass-memory (`cm`) keeps working regardless of the real
cass index's health. cm's `cassPath` config (or `CASS_PATH` env) is pointed at
the shim; the shim answers cm's six pinned call sites — availability
(`--version`), `search --robot`, `export`, `timeline --json`, `stats --json`,
and index-free unprocessed-session discovery via timeline — using
`createSessionSearch` in-process (the pattern at `src/cli.ts:606-611`,
verified present at `src/cli.ts:609`). The managed MCP surface is untouched:
`search_sessions` remains the only managed tool, per `DESIGN.md` and ADR 0001.

This is a **compatibility adapter lane**, not a new search surface. The shim
re-presents existing engine output in real-cass v0.6.22 wire shapes; it adds
no indexing, no ranking semantics, and no MCP tools.

## 2. Independent assessment (agreements, disagreements, tradeoffs)

The concept document is unusually well-pinned: cm's consumption contract was
extracted from the actual `cm` bundle (`strings`), and output shapes from the
cass v0.6.22 Rust source, with file/line citations. I verified the local
anchors it relies on and they hold:

- `package.json` `files` is `["dist/*.js", ...]` — a non-recursive glob, so
  the concept's requirement to add `"dist/cass-compat/*.js"` is real, not
  hypothetical. The `bin` map has four entries today; the shim adds a fifth.
- `src/roots.ts` exports `resolveSessionRoots` (`src/roots.ts:116`) and
  `pathMatchesInclude` (`src/roots.ts:306`) — the walker seam exists.
- `test/search.test.ts` has the injected-backend (`createBackend`) test seam
  around line 2716 for contract tests without live FFF.

Points where this draft takes a position beyond (or slightly against) the
concept:

1. **Sequencing: land the companion filters plan first, and drop most of the
   standalone degraded mode.** The concept carries a "documented degraded
   mode if ever run standalone" (shim-side stat/prefix post-filtering when
   `days`/`workspace` engine fields are absent). Since both plans live in one
   package, the shim compiles against whatever `SearchSessionsInput` exists at
   build time — there is no runtime discovery problem. Building and testing a
   second filtering path buys little and doubles the filter test matrix.
   Recommendation: sequence strictly (filters plan merges first; the shim's
   search verb passes `days`/`workspace` straight through) and keep only a
   one-paragraph doc note explaining the fidelity loss if someone backports
   the shim ahead of the filters. Tradeoff preserved: if schedule pressure
   forces the shim first, the concept's post-filter fallback is the right
   escape hatch — it just shouldn't be the default plan of record.

2. **`--version` must be fast on a cold Node start — make the entrypoint
   import-light.** cm's availability gate is `spawnSync([cassPath,
"--version"])` with a 2-second timeout. A Node ESM entry that eagerly
   imports the engine, zod, and fastmcp can flirt with that budget on a cold
   cache. The entry (`src/cass-shim.ts`) should answer `--version` (and
   `health`) before any heavy import, and load verb modules via dynamic
   `import()` per dispatch. This is an implementation-shape requirement, not a
   nice-to-have; add an exec-time assertion to the packaging smoke test.

3. **Synthetic `score` is acceptable but should be flagged in docs.** The
   concept emits rank-derived descending scores (`1 - i*0.05`, floor 0) to
   match the full-fidelity real-cass hit shape. cm treats `score` as optional,
   so omitting it would be safer against misinterpretation; matching the real
   shape wins because it keeps one canonical fixture set and protects against
   future cm versions tightening the schema. Keep the synthetic score, but
   `docs/cass-shim.md` must state it is rank-derived, not a relevance score.

4. **The `export` verb sits in tension with DESIGN.md Non-Goals ("markdown
   exports of session history") — resolve it explicitly, in writing.** The
   concept's resolution (header comment + Non-Goals annotation) is correct but
   under-weighted. Recommendation: in the same branch, add the DESIGN.md
   Product Contract line for the shim bin _and_ annotate the Non-Goals bullet
   to say the ban applies to the engine/CLI/MCP surface, with the shim's
   renderers being a cm-interop adapter only. A short ADR (0002) is optional;
   the DESIGN.md annotation is the minimum bar. Without it, a future cleanup
   pass could legitimately delete `export.ts` citing Non-Goals.

5. **Keep `health` even though the pinned gate is `--version`.** The evidence
   shows cm's availability check never calls `cass health`, but cm's
   user-facing hint text tells humans to run it. A trivial always-ok `health`
   verb costs ~20 lines and prevents a confusing dead end during incident
   triage. Agreed with the concept; noted here because a leaner council draft
   might cut it — don't.

6. **`capabilities --json` should list the shim as a separate entrypoint.**
   DESIGN.md already requires capabilities to document "any separate opt-in
   native entrypoint"; the shim is the same category (separate bin, not a
   managed MCP tool). One line in `src/help.ts` keeps the machine-readable
   contract honest. Managed `mcp.tools` stays exactly `["search_sessions"]`.

## 3. Recommended implementation shape

One new bin, one new module directory, zero changes to managed MCP surfaces:

- `src/cass-shim.ts` — `#!/usr/bin/env node` entry; isEntrypoint guard;
  fast-path `--version`/`health` before heavy imports; verb dispatch via
  dynamic import; top-level catch → stderr error envelope
  `{"error":{code,kind,message,hint,retryable}}`; stdout data-only.
- `src/cass-compat/` — small, individually testable modules:
  - `argv.ts` — tolerant cass-style parsing (`--` handling, repeated
    `--agent`, unknown flags warn on stderr and never fail).
  - `agents.ts` — slug↔source table (`claude_code↔claude`, `codex`,
    `pi_agent↔pi`, `cursor`, `gemini`, `hermes`; unmapped → source name) —
    the `claude_code` mapping is the single sharpest correctness edge.
  - `search.ts` — build `SearchSessionsInput` (candidates mode; pass
    `days`/`workspace` through to the engine fields from the companion plan),
    flatten `CandidateGroup.leads` in group-priority order, dedupe by path
    keeping first, slice to `--limit`, shape the real-cass `--robot`
    envelope. Every hit must satisfy cm's zod schema — notably
    `line_number` always a number (fallback `1`), `agent` a real cass slug.
  - `sessions.ts` — index-free walker shared by timeline/stats:
    `resolveSessionRoots` + `pathMatchesInclude` + `stat`, mtime-based.
  - `export.ts` — tolerant line walkers (claude / codex rollout /
    pi-generic); skip records without confident role+text (never emit
    `=== UNKNOWN ===`); byte-compatible markdown/text renderers; header
    comment declaring cm-interop-adapter status per DESIGN Non-Goals.
  - `timeline.ts`, `stats.ts`, `health.ts`, `errors.ts`, `output.ts`.
- Exit codes: `0` success (including zero hits), `2` usage, `4` not-found,
  `9` unknown/empty-session. Never `3` (index-missing — shim has no index)
  and never `10` (timeout — cm's execFile owns killing).
- Unknown verbs: exit 2 usage envelope naming `~/.local/bin/cass` and the
  supported verb list (user-locked: no passthrough).
- `package.json`: add `"agent-session-search-cass-shim": "dist/cass-shim.js"`
  to `bin`; add `"dist/cass-compat/*.js"` to `files`.

## 4. Ordered implementation steps

Precondition (step 0): confirm the companion `--days`/`--workspace` plan is
merged and `SearchSessionsInput` carries `days`/`workspace`. If it is not,
stop and re-sequence (see Risks) rather than building the degraded filter
path by default.

One branch, three commits, no release between (concept decision, agreed):

**Commit 1 — scaffolding, `--version`, `health`, `search`:**

1. `src/cass-compat/errors.ts` + `output.ts`: exit-code map, stderr envelope
   writer, pretty-printed-JSON + trailing-newline stdout writer.
2. `src/cass-compat/argv.ts` with its test table.
3. `src/cass-compat/agents.ts` slug maps + claude dash-decode helpers.
4. `src/cass-compat/search.ts`: input build → flatten/dedupe/slice →
   real-cass envelope (`{query, limit, offset:0, count, total_matches, hits,
max_tokens:null, request_id:null, cursor:null, hits_clamped:false}`);
   hit derivation per concept (path, line ?? 1, slug, preview, title from
   filename stem, rank-derived score, workspace via claude dash-decode else
   dirname, created_at from stat mtimeMs, source_id/origin_kind "local");
   unknown slug → `hits: []`, exit 0, stderr note; engine warnings → stderr.
5. `src/cass-shim.ts` entry: fast `--version` ("agent-session-search-cass-shim
   <ver> (cass-robot-compat for cm)") and `health` before heavy imports;
   dynamic-import dispatch; top-level catch.
6. `package.json` bin + files entries.
7. Tests: `test/cass-shim-argv.test.ts`, `test/cass-shim-contract.test.ts`
   (cm's zod hit schema encoded verbatim as the acceptance gate, injected
   backend via the `createBackend` seam).

**Commit 2 — `export`:** 8. `src/cass-compat/export.ts`: `~`-expansion, ENOENT → exit 4; tolerant
walkers; zero confident messages → exit 9 "empty-session"; markdown
(`# title` / `*Started: …*` / `## 👤 User` / `## 🤖 Assistant` with `---`
separators) and text (`=== ROLE ===`) renderers byte-matching cass
v0.6.22. 9. Fixtures `test/fixtures/cass-compat/*` + golden-output tests, including
an assertion that cm's UNKNOWN-ratio fallback heuristic scores zero.

**Commit 3 — `timeline`, `stats`, docs, packaging:** 10. `src/cass-compat/sessions.ts` walker; `timeline.ts` (`--since Nd`,
tolerate bare int; mtime cutoff; cap newest 1000; UTC `%Y-%m-%d %H:00`
grouping; deliberate `message_count: 0`, documented); `stats.ts` (no
cutoff, per-root cap 5000, no file reads, `shim:{name,version,engine}`
marker for `cm doctor`). 11. `test/cass-shim-timeline.test.ts` (controlled mtimes; simulate cm's
groups-parse); packaging test additions (`dist/cass-shim.js` +
`dist/cass-compat/` file present in installed set; `--version` exec
smoke with a wall-clock bound). 12. Docs: DESIGN.md Product Contract line + Non-Goals annotation;
`docs/cass-shim.md` (verbs, argv/JSON reference, slug mapping table,
synthetic-score caveat, degraded-mode note, activation/rollback
runbook); `src/help.ts` capabilities entry for the shim bin.

Then the verification contract (section 6) end-to-end before merge.

## 5. Files/modules likely to change

New: `src/cass-shim.ts`; `src/cass-compat/{argv,agents,search,sessions,
timeline,stats,health,export,errors,output}.ts`; `test/cass-shim-*.test.ts`
(argv, contract, export, timeline); `test/fixtures/cass-compat/*`;
`docs/cass-shim.md`.

Modified: `package.json` (bin, files); `test/packaging.test.ts` (bin loop is
dynamic — asserts only); `DESIGN.md` (Product Contract + Non-Goals
annotation); `src/help.ts` (capabilities entry). Optionally `docs/adr/0002-*`
if the export-adapter exception is recorded as an ADR.

Explicitly NOT changed: `src/server.ts`, `src/tool.ts` schemas beyond what
the companion plan already did, `src/native-server.ts`, `src/fff-native-policy.ts` —
the managed and native MCP lanes are untouched.

## 6. Tests and validation commands

Unit/contract (all via `npm test`, typecheck via `npm run check`):

- `test/cass-shim-contract.test.ts` — cm's zod hit schema verbatim;
  `line_number` numeric when lead.line is undefined; zero hits → exit 0;
  `--agent claude_code` searches only the claude source; unknown slug → `[]`
  exit 0; envelope keys match real cass.
- `test/cass-shim-argv.test.ts` — argv table incl. `--`, repeated `--agent`,
  missing query → exit-2 stderr envelope with empty stdout.
- `test/cass-shim-export.test.ts` — golden outputs per fixture; UNKNOWN
  heuristic zero; ENOENT → 4; garbage → 9.
- `test/cass-shim-timeline.test.ts` — grouping keys, cutoff, slugs, cm
  groups-parse simulation.
- `test/packaging.test.ts` — installed-set + `--version` exec smoke (<2s).

Live verification (acceptance bar, in order):

```bash
npm run check && npm test && npm run build
dist/cass-shim.js --version                                  # exit 0, <2s
dist/cass-shim.js search --limit 5 --days 7 --robot -- "vitest" | jq .
dist/cass-shim.js timeline --since 7d --json | jq '.groups | keys'
dist/cass-shim.js export --format text -- <real-claude.jsonl> \
  | grep -c "=== UNKNOWN ==="                                # must be 0
CASS_PATH=$PWD/dist/cass-shim.js cm doctor                   # shim-marked stats
CASS_PATH=$PWD/dist/cass-shim.js cm context "recent work" --json  # no `degraded`
CASS_PATH=$PWD/dist/cass-shim.js cm reflect --dry-run --days 1    # ≥1 session, no export fallback
time (CASS_PATH=$PWD/dist/cass-shim.js cm context "recent work" --json)  # <4s target, 8s hard
unset CASS_PATH; cm doctor                                   # rollback: real cass again
```

## 7. Risks, constraints, and open questions that would change order

- **Companion-plan sequencing (order-changing).** If the `--days`/`--workspace`
  filters plan has not merged when shim work starts, either pause the shim or
  consciously adopt the concept's degraded post-filter mode as commit 1 scope
  — do not let the degraded path drift in as an accident. This is the single
  decision that reorders the plan.
- **cm contract drift.** The consumption contract is pinned to the 2026-07-19
  cm build via `strings`. Any cm upgrade requires re-running the extraction
  before trusting the shim. Mitigation: the contract test encodes cm's zod
  schema verbatim, and `docs/cass-shim.md` records the re-verification step.
- **`line_number` non-nullability** is the sharpest schema edge (one bad hit
  fails cm's whole search parse). Guarded by a dedicated contract test.
- **Agent slug mismatch** (`claude` vs `claude_code`) silently filters all
  enrichment in cm. Guarded by `agents.ts` table tests and the live
  `cm context` smoke.
- **8-second cm search budget.** The engine spawns FFF children per source;
  cold spawns on a large corpus could approach the budget. Mitigation:
  latency smoke (<4s target) before merge; cm degrades to TIMEOUT gracefully
  if exceeded, so failure is soft. If the smoke fails, consider limiting the
  shim's default source set — a scope change, hence flagged here.
- **Cold-start `--version` under cm's 2s spawnSync timeout.** Mitigated by
  the import-light entry (section 2.2) and the timed packaging smoke.
- **Session-format drift** in export walkers: tolerant parsing, worst case
  exit 9 → cm falls back to its own parser (graceful by design).
- **Non-Goals optics.** The export renderers must not be interpreted as the
  banned "markdown exports" product feature; the DESIGN.md annotation and
  header comment are part of the deliverable, not optional polish.
- **`created_at` semantics.** Real cass emits session start time; the shim
  emits file mtime. cm treats the field as optional/loose — acceptable, but
  document the difference so nobody "fixes" it into a file-content parse.
- **Open question:** should `cm doctor`'s stats marker (`shim:{…}`) also be
  surfaced through `agent-session-search-doctor`? Not required for
  acceptance; defer to a Bead if wanted.
