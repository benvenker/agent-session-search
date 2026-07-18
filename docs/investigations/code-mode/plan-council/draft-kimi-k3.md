# Code Mode (`session_search_code`) — Plan Draft (kimi-k3)

- Date: 2026-07-18
- Author: kimi-k3 (plan council, one of three provider drafts)
- Status: independent planning draft for council synthesis; not an accepted plan
- Inputs: `docs/investigations/code-mode/plan-council/input-concept.md`, `docs/investigations/code-mode/2026-07-18-digest-brief.md`, `docs/prototypes/findings/2026-07-18-code-mode-client-side-prototype.md`, `docs/investigations/code-mode/2026-07-18-prototype-findings-council.md`, `docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md` (R12), `docs/adr/0001-fff-core-and-native-policy-strictness.md`, `DESIGN.md`, `CONTEXT.md`, `docs/agents/prototyping.md`

## 1. Concept intent

R12 of the two-lane plan defers a `session_search_code` Code Mode frontend "until native-lane usage shows programmable fanout, pagination, and result filtering justify it." This draft answers that gate with the first round of measured evidence in hand: a client-side generated-TypeScript prototype against `agent-session-search-native-mcp`, stress-tested by a four-model findings council. The decision is genuinely open — "do not implement now" and "documented client-side pattern only" are both legitimate outcomes, and this draft picks between them explicitly rather than defaulting to implementation.

## 2. R12 gate verdict

**Verdict: decline a shipped `session_search_code` tool now; proceed immediately with a documented client-side pattern only (docs-only, zero new product surface); rerun a fair gate after the prerequisites in §4.4 land or the evidence triggers in §8 fire.**

This is not "defer and do nothing," and it is not "the prototype disproved Code Mode." It is the council's own framing: *do not ship on this evidence; rerun a fair gate* — while capturing the one durable positive result (a working client-side SDK recipe) at zero product cost.

### 2.1 Evidence for the verdict (measured, not vibes)

Against shipping a tool now:

- **Comparative benefit is unproven.** The digest's central question — does generated code beat the managed lane an agent already has? — was never validly answered. The managed arm retained 0/0 on all five tasks (a 2-byte `[]`) and was never diagnosed; it ran one long natural-language query with no explicit `queries`, no `callerSession` demotion, and no candidate/evidence follow-ups (council §3, §6.1). Shipping a new surface while the incumbent comparison is broken would be deciding on a strawman.
- **Precision was not validly measured and partly contradicted.** Automated precision is circular (`decisive = retained.length`); hand scoring found only 9/19 retained generated hits decisive, with 0/3 on native-lane adoption and 0/2 on R13 archaeology — the two most product-relevant tasks (findings, gate-criteria table; council §4).
- **Self-contamination invalidates the strongest positive cells.** 2 of 4 SDK "decisive" hits and at least 2 of 8 packaging hits come from the prototype's own build session (omp `2026-07-18T01-10-36`); 6/19 retained hits overall trace to contemporaneous pipeline sessions (council §6.2). Decontaminated, the byte-savings criterion passes cleanly on exactly one task (root-wide, 2/2, 97.63%).
- **Pagination value was not demonstrated.** No answer changed on any task; both native arms used stacked `maxResults: 10` pages, so the experiment showed pagination beats a 10-result page, not the default 50 or 200-result ceiling a manual agent gets in one call (council §4, §6.4).
- **Raw FFF presentation text is a brittle extraction interface — the most robust substantive negative.** Lexical filtering over raw text produced plausible false positives at 10/19 retained hits, requiring human review. An unattended `session_search_code` over today's native output contract would ship exactly this brittleness (council §5, item 3).
- **The adoption gate is still a null.** Zero hand-decisive organic post-ship native-lane usage hits. This is absence of evidence inside a ~1-day, n=3, contamination-prone window — not evidence of absence — but R12's own wording requires *demonstrated* usage value, and there is none.

For the documented-pattern option (why not pure defer):

- **Repo-local client-side SDK composition works today at zero product cost.** A shared 88-line harness (`run-battery.ts`) using the already-installed `@modelcontextprotocol/sdk` `Client` + `StdioClientTransport` spawned `node dist/native-server.js`, discovered 7 healthy sources, and drove fanout, cursor pagination, and filtering — the one gate criterion that passes cleanly (ergonomics, <150 LOC).
- **No infrastructure failure under light load.** 65 generated native calls + 1 capabilities call (101 total to the process including manual arms): zero budget, timeout, concurrency, or 4 MiB failures against the shipped budgets (256 attempted, 4 concurrent, 50/200 results, 4,194,304 bytes).
- **Large serialized-byte reductions are real and reproducible** (91.95%–98.24% across all five generated arms), even if the evidence-preservation side of that claim is only clean on one task.
- All four council reviewers accept "do not productize now"; none reverse it; one (codex-5.6-sol-x-high) explicitly notes the findings *understate* the case for a documented experimental client pattern.

### 2.2 What evidence would change the verdict

The verdict flips toward a shipped frontend only when **all** of the following hold:

1. A rerun gate (protocol in §8.3) shows generated code beats a *fairly armed* managed lane — explicit literal `queries`, `callerSession` demotion, candidate/evidence follow-ups — on answerability, not just bytes.
2. A typed/structured native result contract (or an equivalent stable extraction surface) exists, so client filtering no longer parses presentation text; precision must be measured non-circularly against a recorded rubric and a scored raw baseline.
3. Organic, contamination-controlled native-lane usage appears (trigger T1 in §8.1), or a rerun demonstrates answer-changing pagination at realistic page sizes.
4. End-to-end token economics (generated code + protocol overhead + synthesis) show a real margin over the managed lane, per the digest §5 open question — byte-vs-raw-envelope savings are not accepted as a proxy.

## 3. Recommended shape

### 3.1 What ships now: a documented client-side pattern (docs-only)

A short, explicitly **experimental** recipe for advanced agents: client-side generated TypeScript that connects to the opt-in native MCP server over stdio and composes `fff_grep` / `fff_multi_grep` / `fff_native_capabilities` directly. It documents what the prototype proved viable and encodes the guardrails the prototype learned the hard way. No new MCP tool, no third binary, no `src/` changes, no package surface changes.

### 3.2 Execution model and trust story

- **Execution location:** the agent's own process/worktree, not the product server. The agent writes and runs ordinary TypeScript with its existing local privileges; the product never executes agent-supplied code. This keeps `DESIGN.md`'s arbitrary-code-execution non-goal untouched — server-side Code Mode stays out of scope, and this draft recommends no path toward it.
- **Trust boundary:** the native server remains the enforcement point — fail-closed fingerprint policy (ADR 0001), source-bound calls, projected schemas, process-local budgets (256 attempted / 4 concurrent / 15s / 50–200 results / 4 MiB). Client-side code cannot widen exposure; it can only compose what policy already exposes. The recipe must say so explicitly so nobody treats the pattern as an exposure-path bypass.
- **Read-only:** the pattern is read-only by construction of the native policy, not by convention.

### 3.3 Relationship to the other lanes

- **Managed lane:** untouched. `search_sessions` stays the one-tool default and the first thing agents reach for. The recipe is positioned as a fallback for when the managed lane demonstrably cannot express the composition needed — and the recipe says to file that as evidence (feeding §8) rather than silently working around it.
- **Native lane:** consumed as-is. No policy change, no new exposed tools, no schema change. The recipe pins itself to `fff_native_capabilities` discovery (sources, budgets, policy version) instead of hardcoding assumptions.
- **CLI-first SDK fallback (`agent-session-search native call ...`):** remains the deferred alternative frontend, unchanged. The relationship: the documented TS pattern serves agents that can generate code; the CLI-first shape would serve agents/shells that cannot. They share one prerequisite — a typed JSON result mode would make *both* more viable — so the CLI-first evaluation inherits this plan's evidence triggers rather than running a parallel track. If a typed CLI JSON mode ever lands first, re-evaluate whether the TS pattern still carries its weight (open question Q3, §10).

### 3.4 Upstream prerequisites and which shapes they gate

| Prerequisite | Status | Gates |
| --- | --- | --- |
| Typed/structured native result contract | Not started; **tension:** the two-lane plan currently says typed schemas stay upstream-owned and the wrapper does not infer structured outputs | Any shipped `session_search_code`; any promoted helper; a serious CLI-first SDK. This is the single highest-leverage follow-up (§3.5, §10 Q1) |
| Executable-bit packaging fix (`dist/` bins mode 664 → EACCES on direct exec) | Confirmed worktree artifact; tracked separately (Session A / Beads); installed-artifact evidence (777/775) suggests it may not reproduce from a packed install | Ergonomics of the documented pattern (recipe must currently say `node dist/native-server.js`); any shipped binary |
| `shownLeadCount` shape mismatch; doctor `multi_grep` false-green | Tracked separately | Referenced only; this plan must not absorb them (concept hard constraint) |

### 3.5 Follow-up track this plan recommends but does not spec

Open a **separate** planning thread for a typed/structured native result contract. It is the council's highest-priority implication and would help the managed lane, the native lane, the CLI fallback, and any future Code Mode simultaneously. It is deliberately *not* an implementation unit here: it collides head-on with the two-lane plan's "typed result schemas remain upstream-owned" deferral, so it needs its own decision record (upstream FFF structured output vs. amending that deferral) rather than being smuggled through a Code Mode plan. This plan's only action is to file it as a Beads-tracked follow-up with the R12 context attached (U4).

## 4. Ordered implementation units

All units are docs/process-only. Nothing in this plan modifies `src/`, `package.json`, or any shipped surface.

### U1. Write the experimental client-side recipe doc

- **Goal:** capture the proven-viable client-side SDK pattern with its guardrails, marked experimental.
- **Dependencies:** none.
- **Files:** create `docs/recipes/code-mode-client-pattern.md`; link it from `docs/native-mcp.md` (one paragraph under a new "Client-side composition" note) and from the DESIGN.md Deferred Ideas Code Mode bullet.
- **Content requirements (distilled from the prototype's measured lessons):**
  - Connect via `@modelcontextprotocol/sdk` `Client` + `StdioClientTransport` spawning `node dist/native-server.js` (document the mode-664 EACCES workaround verbatim; do not paper over it).
  - Always call `fff_native_capabilities` first; read sources, budgets, and policy version from it; never hardcode source names.
  - Respect budgets client-side: sequential or ≤4-concurrent calls, bounded page counts, expect the 15s timeout and 4 MiB ceiling.
  - Exclude your own pipeline sessions **by session id/path**, not by preview-token filters (6/19 contamination hits came from exactly that mistake).
  - Prefer structural filters (path, date, source) over lexical scoring of presentation text; state plainly that raw FFF text parsing produced 10/19 false positives and every retained hit needs human review.
  - One reusable-helper shape (~the 88-line harness pattern: connect → capabilities → fanout → paginate → filter → emit compact JSON), not five bespoke scripts.
  - Explicitly experimental: no stability promise, not a supported API, prototype harness not included and not promoted (per the findings doc's own promotion recommendation and `docs/agents/prototyping.md`).
- **Test scenarios:**
  - Happy path: a fresh agent following only the doc can run the minimal example against `node dist/native-server.js` and get a capabilities + fanned-out result (validated manually once per §7, then on each release per U3).
  - Error path: doc's own workaround covers direct-bin EACCES; verify `./dist/native-server.js` failure and `node dist/native-server.js` success in the validation pass.
  - Docs contract: every command in the doc is copy-paste runnable from repo root; links resolve (checked in review).
- **Verification:** doc exists, is linked from `docs/native-mcp.md` and DESIGN.md Deferred Ideas; minimal example validated end-to-end once from a clean checkout of the worktree.

### U2. Record the R12 gate outcome in DESIGN.md and AGENTS.md-adjacent docs

- **Goal:** make the gate outcome discoverable so the next planner does not re-open a settled question.
- **Dependencies:** U1 (so the Deferred Ideas bullet can point at the recipe).
- **Files:** modify `DESIGN.md` (Deferred Ideas: replace the "Read-only Code Mode" bullet with the gate outcome — declined for now as a shipped tool, documented pattern at `docs/recipes/code-mode-client-pattern.md`, revisit triggers summarized); modify `docs/investigations/code-mode/` README or index if the council synthesis creates one (council-owned, not this draft).
- **Approach:** one paragraph, dated, citing the findings doc and council report. Do not rewrite the two-lane plan document — it is a historical accepted plan; the outcome lives in DESIGN.md as the current design record.
- **Test scenarios:** none — prose-only. Reviewer check: DESIGN.md still states the arbitrary-code non-goal unchanged.
- **Verification:** `grep -n "Code Mode" DESIGN.md` shows the updated bullet; no other DESIGN.md section touched.

### U3. Add a recipe-validation step to release smoke (lightweight)

- **Goal:** keep the recipe honest as the native lane evolves.
- **Dependencies:** U1.
- **Files:** modify the recipe doc only — add a "last validated" header line (date + commit + `npm run build && node dist/native-server.js` smoke result). Optionally, if maintainers want automation later, a `scripts/check-code-mode-recipe.mjs` alongside existing `scripts/` — **deferred**, not part of this unit (see §9).
- **Approach:** manual, checklist-style, run on each release that touches `src/native-server.ts` / `src/fff-native-policy.ts` / `src/fff-capability-router.ts`: rebuild, run the recipe's minimal example, update the header. No CI wiring in this plan.
- **Test scenarios:** none — process step.
- **Verification:** header line present and current after the next relevant release.

### U4. File the follow-up Beads (no implementation)

- **Goal:** convert this decision into tracked work without starting any of it.
- **Dependencies:** council synthesis accepting this direction (or its merged equivalent).
- **Beads to file (titles, not specs):**
  1. "Typed/structured native result contract — decision record needed (upstream-owned vs. wrapper-inferred)" — references this draft §10 Q1, council implication #2, and the two-lane plan's typed-schema deferral. Highest leverage.
  2. "R12 gate rerun — fair managed-arm comparison with fixed methodology" — carries §8.3 as its protocol sketch; blocked on trigger T4 (90-day) or earlier if T1/T2 fire.
  3. "Code Mode evidence watch — monthly organic native-lane usage check" — recurring-lite process bead carrying §8.1 queries.
  4. "Packed-install executable-bit verification for dist bins" — reference only, to be linked onto the existing Session A packaging bead, **not** a new competing bead.
- **Test scenarios:** none.
- **Verification:** `br list` shows the beads; bead 2 links the rerun protocol.

## 5. Files/modules touched (consolidated)

- Create: `docs/recipes/code-mode-client-pattern.md` (U1)
- Modify: `docs/native-mcp.md` (U1, one section), `DESIGN.md` Deferred Ideas (U2)
- Create (council/Beads metadata only): the plan-council synthesis may cite this draft; Beads items per U4
- Explicitly untouched: everything under `src/`, `test/`, `package.json`, `.mcp.json`, the managed lane, the native policy, and `.worktrees/code-mode-proto/` (throwaway; nothing promoted)

## 6. Tests / validation

- `npm run check` — must pass (docs-only change, but the repo pre-commit runs it; confirm no incidental breakage).
- `npm test` — must pass unchanged; this plan adds no code and therefore no new unit tests. (AGENTS.md guardrail: focused tests for the module touched — no module is touched.)
- Recipe validation (U1, manual, from the worktree): `npm run build`, then run the doc's minimal example with `npx tsx <example>` against `node dist/native-server.js`; confirm capabilities output lists the 7 sources and a one-source `fff_grep` call returns raw results; confirm `./dist/native-server.js` fails EACCES and the documented workaround succeeds.
- Docs review: links from `docs/native-mcp.md` and `DESIGN.md` resolve; every command in the recipe runs from repo root verbatim.
- `br list` — U4 beads exist with the stated links.

## 7. Implementation venue

**Yes — proceed in a git worktree.** This very planning work happens in `.worktrees/code-mode`, and the docs units (U1–U3) should land the same way: a short-lived worktree branch, docs merged back to the main planning branch, per `docs/agents/prototyping.md`'s "merge evidence/docs, not scaffolding" rule. Reasons:

1. The prototype precedent: experiments in `.worktrees/code-mode-proto`, durable findings merged, scripts abandoned — this plan continues that hygiene, and U1 is itself a docs artifact distilled from throwaway work.
2. Isolation from the native-lane eval fixes landing concurrently (Session A / Beads) — docs about an experimental recipe should not ride along with packaging/policy code changes; separate branches keep review scopes clean.
3. Reversibility: if the council synthesis picks a different draft's direction, the worktree is discarded with zero mainline footprint.

If a future fair-gate rerun ever green-lights real implementation, that work gets its **own** fresh worktree off main plus a full plan → Beads graph — it never "promotes" `.worktrees/code-mode-proto` scripts (concept hard constraint; findings doc promotion recommendation: do not promote).

## 8. Evidence maintenance — keeping R12 from freezing on one round

### 8.1 Organic usage observation (zero-instrumentation default)

Do **not** add telemetry to the native server — that would be a product change smuggled in as evidence-gathering. Instead, run a monthly manual check (U4 bead 3) over the local session corpus, reusing what already exists:

- `search_sessions` (managed lane) with `queries: ["fff_grep", "fff_multi_grep", "fff_native_capabilities", "StdioClientTransport", "native-mcp"]`, scoped post-2026-07-17, excluding pipeline/planning sessions by session id.
- `cass search "fff_grep" --workspace /data/projects/agent-session-search --json --fields minimal --limit 20` (with `timeout`, per AGENTS.md; the digest recorded CASS timeouts, so treat CASS as best-effort and record degradation).
- Log results (date, query, decisive hits y/n) as a running appendix in the rerun bead — a dated evidence log, not a dashboard.

Open question (recorded, not decided here): if observation stays blind (agents don't narrate tool use in searchable text), a future native-lane opt-in usage-counter (`_meta` echo or a local counters file) could be proposed **as its own plan** — out of scope here.

### 8.2 Revisit triggers (any one fires the rerun bead)

- **T1 — organic usage:** ≥5 distinct non-pipeline sessions using native tools for fanout/pagination/filtering observed across two consecutive monthly checks.
- **T2 — typed results land:** the U4-bead-1 decision record resolves with a shipped structured/typed result mode.
- **T3 — packaging confirmed fixed:** packed/installed artifact verified executable (the mode-664 question resolved at the packaging layer).
- **T4 — time:** 90 days from this decision (≈ 2026-10-16) with no other trigger — rerun anyway, so "no news" is a deliberate re-confirmation, not silent freeze.

### 8.3 Rerun protocol (must-fix methodology, from council §6)

The rerun is a new throwaway-worktree prototype, not a re-read of this round. Non-negotiable fixes:

1. Fair managed arm: explicit literal `queries`, `callerSession` demotion, candidate-group continuation, `more.evidence` follow-ups; diagnose any 0/0 before concluding.
2. Contamination control: frozen corpus snapshot or pre-experiment cutoff; exclusions by session id/metadata, never preview tokens; consistent decontamination standard across all arms.
3. Non-circular metrics: recorded scoring rubric, per-hit annotations, independent second assessor; score the raw-native baseline too; recall-audit discarded hits against a ground-truth evidence set per task.
4. Realistic pagination arms: single calls at default 50 and ceiling 200; a manual-pagination arm; record whether any answer changes; remove/justify page caps.
5. Token economics: end-to-end context/token cost per arm (generated code + protocol overhead + synthesis), with pass thresholds defined **before** running.
6. No known-answer filters: decisive lists must not hardcode strings the author already expects.
7. Honest ergonomics accounting: count all iterations, probes, and hand-scoring labor, not just the final shared harness LOC.
8. Packaging claims only from packed/installed artifacts.

## 9. Risks and mitigations

- **The recipe calcifies into an unsupported de-facto API.** Mitigation: header marks it experimental, no stability promise, validation is manual per-release (U3), and DESIGN.md states no shipped surface exists.
- **The recipe teaches brittle raw-text parsing and agents trust its output.** Mitigation: the doc leads with the 10/19 false-positive measurement, mandates structural-over-lexical filtering, and requires human review of retained hits. Residual risk accepted: it's a documented advanced-agent pattern, not an unattended surface.
- **Decision freeze.** Mitigation: T4 time trigger plus the monthly evidence-log bead; "no evidence" becomes an active re-confirmation.
- **Scope creep into the three tracked native-lane eval issues** (bin modes, `shownLeadCount`, doctor false-green). Mitigation: §3.4 references them as prerequisites only; U4 links rather than duplicates the packaging bead.
- **Docs drift from shipped behavior.** Mitigation: U3 re-validation on any release touching the three native modules.
- **The typed-results follow-up stalls because the two-lane plan deferred it.** Mitigation: U4 bead 1 forces an explicit decision record instead of letting the deferral silently stand (see §10 Q1 — this is the risk most likely to strand the whole Code Mode question).
- **Token economics never get measured and the next gate repeats the byte-strawman.** Mitigation: §8.3 item 5 makes pre-registered thresholds a rerun entry requirement.
- **Council picks a different draft.** Accepted: this draft preserves its disagreements (§11) so a synthesis can merge rather than restart.

## 10. Order-changing open questions

- **Q1 (highest leverage): typed result contract vs. the two-lane plan's deferral.** The plan says typed schemas stay upstream-owned and the wrapper does not infer structured outputs; the council says a typed contract is the top priority. If the decision record lands on "stays upstream-owned and upstream has no plans," then raw presentation text is the permanent extraction ceiling — which likely caps Code Mode at the documented pattern forever and should be said out loud in DESIGN.md rather than discovered later. This can reorder everything: it decides whether "ship a tool" is even on the table for any future gate.
- **Q2: does a fairly armed managed lane erase the pagination/filtering value?** If yes, the rerun's bar shifts from "beat managed" to "serve compositions managed structurally cannot express" — a different, narrower product question.
- **Q3: does a typed CLI JSON mode subsume the TS pattern?** If the CLI-first fallback gets structured output first, the client-side TS recipe may shrink to a niche; the two tracks must share evidence rather than race.
- **Q4: budgets under real fanout.** 101 sequential calls never stressed the 4-concurrent limit or near-budget behavior; if organic patterns emerge that need concurrency, the budget constants (256/4/15s/4MiB) may need review — a native-policy question, not a Code Mode one.

## 11. Preserved disagreements and tradeoffs

- **Fanout replacement:** fable scored it a clean pass; codex-5.6-sol-x-high scored it insufficient (13 sequential calls wrap but don't reduce backend calls, exercise no concurrency); kimi-k3/codex-5.6-sol-high landed between. This draft treats it as *mechanically supported, comparatively unproven* — which is why U1 documents the pattern but nothing ships.
- **Adoption null strength:** the findings doc states the negative slightly more strongly than a ~1-day, n=3 window supports. This draft deliberately frames it as "still-open," matching kimi-k3 and codex-5.6-sol-high against fable's gate-fail reading.
- **Byte-savings claim:** findings say "supported on 3 tasks"; kimi-k3 says cleanly 1 after decontamination; codex-5.6-sol-x-high adds the never-recall-audited discarded hits. This draft uses the decontaminated reading — the conservative number is the one a gate should stand on.
- **Raw-text contract wording:** "not a stable enough contract" overstates what was tested (brittleness at a fixed version, not longitudinal instability). This draft says "brittle extraction interface," and notes Q1 is the real decision that wording was gesturing at.
- **Packaging friction scope:** worktree-artifact mode 664 confirmed; installed-artifact evidence (777/775, exit 0) suggests it may not reproduce from a packed install. This draft keeps the claim local and routes verification through the existing packaging bead.
- **Tradeoff accepted:** documenting an experimental pattern creates a small maintenance obligation (U3) and a small de-facto-API risk (§9) in exchange for capturing the prototype's one clean positive at zero product cost and keeping the evidence loop alive. Pure defer would be cleaner but loses the recipe and weakens the revisit triggers; shipping anything now would be deciding against the evidence.

## 12. Explicit non-goals

- No `session_search_code` MCP tool, in any lane.
- No server-side arbitrary code execution, sandboxed or otherwise — `DESIGN.md` non-goal stands; this draft recommends no path that requires overcoming it.
- No changes to the managed lane's one-tool contract or the native fail-closed policy (ADR 0001 untouched; no exposure-path bypass).
- No promotion of `.worktrees/code-mode-proto` scripts into the product or into `scripts/` as supported tools.
- No fixing of the three tracked native-lane eval issues (bin modes, `shownLeadCount`, doctor `multi_grep` false-green) — referenced as prerequisites only.
- No new telemetry/instrumentation code in the native server (§8.1 explains the zero-instrumentation default; any future counter is its own plan).
- No spec of the typed result contract itself — only a filed decision-record bead (U4).
- No CI automation for recipe validation (manual per-release checklist; automation deferred).
