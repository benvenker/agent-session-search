# Code Mode (`session_search_code`) — Plan Council Draft (fable)

- Author: fable
- Date: 2026-07-18
- Status: independent plan-council draft (one of three)
- Concept input: `docs/investigations/code-mode/plan-council/input-concept.md`
- Evidence ground truth: `docs/investigations/code-mode/2026-07-18-digest-brief.md`, `docs/prototypes/findings/2026-07-18-code-mode-client-side-prototype.md`, `docs/investigations/code-mode/2026-07-18-prototype-findings-council.md`
- Governing constraints: `docs/adr/0001-fff-core-and-native-policy-strictness.md` (FFF-as-core), `DESIGN.md` (arbitrary-code non-goal, one-tool managed boundary), `docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md` (R12, R13, deferred frontends)

## 1. Concept intent

R12 of the two-lane plan gates a `session_search_code` Code Mode frontend on native-lane usage showing that programmable fanout, pagination, and result filtering justify it. One prototype round (client-side generated TypeScript over `@modelcontextprotocol/sdk` against the built native server) plus a four-model findings council has now produced the first gate evidence. This draft is a **gate-evaluation plan**: its job is to take a position on the R12 verdict, define the smallest implementation consistent with that verdict, and make sure the gate keeps accumulating evidence instead of freezing on one round.

Legitimate outcomes were pre-declared: ship a tool, ship a documented client-side pattern only, defer pending evidence, or decline. This draft picks a composite of the middle two and rejects the outer two.

## 2. R12 gate verdict

**Verdict: proceed as a documented client-side pattern only. Defer the shipped `session_search_code` frontend behind named revisit triggers. Decline nothing permanently except server-side arbitrary execution, which stays a `DESIGN.md` non-goal.**

Concretely:

1. **No `session_search_code` implementation track opens now.** No new tool on either lane, no third binary, no expression language, no server-side execution.
2. **The one clean win ships at doc cost:** a short, tested client-side composition recipe in `docs/native-mcp.md`, promoted per the prototype lifecycle rules as a fresh minimal artifact — explicitly not the prototype harness.
3. **The gate stays open, with the decision recorded in an ADR** and a documented, repeatable adoption-sweep procedure so round 2 runs against better evidence than round 1.

### Why not ship a tool (evidence against, from the measurements)

- **The central comparison was never validly run.** The managed arm retained 0/0 on all five tasks (a 2-byte `[]`) and was never diagnosed; it received one long natural-language query with no literal `queries`, no `callerSession` demotion, and no `more.evidence` follow-ups. The council unanimously reclassified this from "managed lane was noisy" to "the managed comparison failed and is unexplained." A frontend justified by beating the managed lane cannot ship on a round where the managed lane never got to play.
- **The value criteria did not survive council review.** Byte savings held cleanly on one task, not three (root-wide: 26,229 → 623 bytes, 97.63%, 2/2 hand-decisive; the SDK task's 4/4 included 2 self-contaminated hits from the prototype's own build session; packaging's decisive hit was cheaper in the manual-native arm, 354 vs 2,619 bytes). Pagination value was rejected as demonstrated: both native arms stacked `maxResults: 10` pages, so pagination beat a 10-result page — never the default 50 or ceiling 200 an agent gets in one call — and no answer changed on any task. Precision was "not validly measured": the automated metric was circular (`decisive = retained.length`), and post-hoc hand scoring found only 9/19 retained hits decisive (adoption 0/3, R13 0/2).
- **The best-evidenced substantive negative is structural.** Raw FFF presentation text is a brittle programmatic interface: lexical filtering over it produced plausible false positives at a rate (10/19 non-decisive) that would be unacceptable in an unattended product surface. A shipped `session_search_code` today would productize exactly that brittleness. Critically, the wrapper cannot fix this without violating its own boundary — the two-lane plan pins typed result schemas as **upstream-owned** ("the wrapper does not infer structured outputs from FFF's presentation-oriented text"), and ADR 0001 forbids re-implementing search semantics. So the blocker is not "more prototyping"; it is an upstream contract that does not exist yet.
- **Council evidence-strength assessment:** FOR productizing — weak (feasibility only); AGAINST productizing now — moderate. No reviewer would reverse the do-not-productize conclusion.

### Why not decline outright (evidence for keeping the path alive)

- **Feasibility is proven, cheaply.** One 88-line shared script performed capabilities discovery, 7-source fanout, cursor pagination, filtering, managed comparison, and metrics capture — under the digest's ~150 LOC ergonomics ceiling, the one gate criterion that passed cleanly. `Client` + `StdioClientTransport` against `node dist/native-server.js` connected with installed dependencies and zero SDK friction.
- **The native lane's envelope held.** 101 calls to one process (65 generated-arm + 35 manual + 1 capabilities) with zero budget, timeout, concurrency, or 4 MiB failures against the 256/4/15s/4MiB budgets.
- **The adoption null is weak, not damning.** A ~1-day observation window for a lane that shipped 2026-07-17, n=3 retained hits, in a contamination-prone corpus, is absence of evidence — the council explicitly softened it to "re-confirming the digest's prior null." Declining would close the gate on a criterion that has not had time to be tested.

### Why a documented pattern is the right-sized positive step

Feasibility evidence is not gate evidence for a shipped tool — but it is *complete* evidence for a documented pattern, because a pattern's entire cost is a doc and its correctness was directly demonstrated. The council's own restatement: the prototype "justifies documenting an experimental client-side recipe; it does not by itself justify a shipped tool." Withholding the doc discards the round's only clean win and guarantees the next advanced agent re-derives the recipe from scratch, likely repeating the exact mistakes this round already paid for (self-contamination, 10-result pagination, unverified lexical filters).

## 3. Recommended implementation shape

- **Where it lives:** documentation plus one repo test. The recipe becomes a "Client-side composition" section of `docs/native-mcp.md` — the native lane's existing doc — not a new binary, not a new tool, not a new package export. `session_search_code` remains a name for a *possible future frontend*, recorded as deferred in the ADR.
- **Execution model:** the composing code runs in the **agent's own execution context** (its worktree, its permission harness), exactly as the prototype did. Nothing executes inside any shipped server.
- **Trust/sandbox story:** unchanged by construction. The native server remains the sole enforcement point — fail-closed policy, fingerprint pinning, required `source`, read-only approved tools, process-local budgets (256 calls / 4 concurrent / 15s / 50-default / 200-ceiling / 4 MiB). Client-side composition adds zero new server-side trust surface; an agent running the recipe can do nothing an agent calling the native tools by hand cannot already do. This is precisely why the client-side shape wins over any server-side shape at current evidence.
- **Relationship to the native lane:** the recipe is a *usage pattern of* the native lane, not a sibling of it. It must route every search through `fff_grep` / `fff_multi_grep` / `fff_native_capabilities` as shipped — extending FFF through the existing lane per ADR 0001, never re-implementing search.
- **Relationship to the CLI-first SDK fallback:** stated, not absorbed. The deferred CLI-first shape (`agent-session-search native call ...`) and the MCP-SDK recipe are competing transports for the same composition idea. Do not build both. If the CLI-first lane is ever prioritized, round 2 evaluates them jointly and picks one frontend. An honest note for that round: a CLI `native call --json` could emit an **envelope-level** JSON (raw upstream text + `_meta`, unparsed) without violating the upstream-owned-schemas boundary — envelope JSON is not inferred structure. That is the fallback shape if upstream FFF never ships `structuredContent`.
- **Upstream prerequisite for any shipped frontend:** typed/structured native results. R10 already obligates the native lane to pass `structuredContent` through unmodified, so the moment upstream FFF ships structured results for `grep`/`multi_grep`, the native lane delivers them at zero wrapper cost — and the brittleness blocker largely dissolves. The ask goes upstream; the wrapper waits.

## 4. Ordered implementation units

### U-A. ADR 0002 — record the R12 round-1 verdict (maintainer go/no-go gate)

- **Goal:** make the gate decision durable, auditable, and hard to relitigate from vibes.
- **Files:** create `docs/adr/0002-code-mode-r12-gate-round-1.md`.
- **Approach:** record — verdict (documented pattern yes; shipped `session_search_code` deferred; server-side execution remains a non-goal); the decisive evidence pointers (findings doc, council report, per-criterion verdict table); the revisit triggers E1–E4 (§6 below); and the methodology contract any round-2 rerun must satisfy (council report §6: fair managed arm with literal `queries` + `callerSession` demotion + follow-ups, session-id-based contamination exclusion, non-circular precision with a recorded rubric, realistic page-size arms at 50/200, recall audit of discarded hits, frozen corpus or pre-experiment cutoff).
- **Gate semantics:** maintainer acceptance of this ADR is the go/no-go for U-B/U-C, mirroring the U4 pattern from the two-lane plan. Rejection ends the plan with zero product change.
- **Tests:** none (docs).

### U-B. Client-side composition recipe — doc section plus executable smoke test

- **Goal:** ship the round's clean win as a tested, honest, explicitly unsupported recipe.
- **Files:** modify `docs/native-mcp.md`; create `test/native-recipe.test.ts`; no `package.json` or `src/` changes.
- **Approach:** add a "Client-side composition (experimental pattern)" section containing one fenced TypeScript block (~40–60 lines) that: connects via `Client` + `StdioClientTransport` spawning `node dist/native-server.js` (with a note that the bin-name launch depends on the separately tracked executable-bit fix); calls `fff_native_capabilities` first and reads sources + budgets; fans out one `fff_multi_grep` per healthy source; paginates with the **default page size** (not 10 — encode the council's page-size lesson); excludes the caller's own session records; and treats retained hits as *leads requiring verification*, not answers. The section must state, and the test must assert the presence of: the unsupported-status warning ("not a supported API; FFF presentation text may change with FFF releases; supported surfaces are `search_sessions`, the CLI, and the native tools themselves"), the raw-text false-positive caveat, the budget table cross-reference, and the root-wide coverage warning. `test/native-recipe.test.ts` extracts the fenced block from the doc and executes it against the same fixture-root machinery as `test/native-mcp-smoke.test.ts`, so the doc cannot silently rot — doc-as-source-of-truth, no separate example file to drift.
- **Explicitly not:** promotion of `.worktrees/code-mode-proto` scripts (the findings doc's promotion verdict is "do not promote"; this is a fresh minimal artifact under the prototyping promotion rule "a script is useful only if it becomes a documented repeatable tool").
- **Test scenarios:** recipe block parses and runs against a fixture root; retained output preserves `_meta` source/root provenance; required warnings present in the doc; managed docs (`docs/mcp.md`, README) still present the managed lane first.

### U-C. Evidence-maintenance procedure and design-memory cross-links

- **Goal:** keep the gate accumulating evidence instead of freezing on round 1.
- **Files:** create `docs/investigations/code-mode/adoption-sweep.md`; modify `DESIGN.md` (one-line amendment to the "Read-only Code Mode" Deferred Ideas bullet pointing at ADR 0002).
- **Approach:** the adoption-sweep doc is a repeatable procedure, not a script: metadata-based date and project scoping (parse session metadata, not path regexes — the round-1 `/2026-07-1[78]/` regex is a recorded defect), exclusion of pipeline/eval sessions by session id, a recorded hand-scoring rubric with per-hit annotations, a sampled recall audit of discarded hits, and a minimum ≥30-day observation window. Define the round-2 open condition: ≥3 distinct non-pipeline sessions using `fff_grep`/`fff_multi_grep` for real work. No telemetry is added to any binary — the session corpus itself is the instrument, which keeps the product local-first and adds zero code.
- **Tests:** none beyond existing doc-drift guards; `DESIGN.md` edit is one bullet.

### Sequencing

U-A first (it is the acceptance gate). U-B and U-C proceed in parallel after acceptance. Total estimated diff: two new docs, one amended doc section, one new test file, one `DESIGN.md` line.

## 5. Implementation venue

**Yes — a fresh git worktree, branched from `main` after council synthesis is accepted** (e.g. `.worktrees/code-mode-recipe`, branch `code-mode-recipe`). Reasons:

1. **Repo convention:** `docs/agents/prototyping.md` and current practice (this planning effort lives in `.worktrees/code-mode`) isolate work-in-progress from mainline; the pre-commit hook runs full `check`/`test`, so iterating on a doc-executing smoke test belongs off-mainline.
2. **Concurrency isolation:** Session A / Beads owns the three native-lane eval issues (bin modes 664, `shownLeadCount` shape, doctor multi_grep false-green) and will touch adjacent files (packaging, preflight, troubleshooting docs). A separate worktree prevents interleaved edits and lets U-B rebase over the executable-bit fix if it lands mid-stream.
3. **Separation of planning from product change:** the `code-mode-planning` branch merges only planning artifacts (council drafts, synthesis, ADR draft text); the recipe worktree merges only the product docs + test. Neither branch mixes the other's concerns.

## 6. Evidence maintenance — revisit triggers

Recorded in ADR 0002; any trigger opens a gate round 2 that must satisfy the methodology contract (council §6).

- **E1 — time-based adoption sweep.** Earliest 2026-08-17 (≥30 days after the native lane shipped 2026-07-17), run `docs/investigations/code-mode/adoption-sweep.md`. ≥3 distinct organic non-pipeline sessions using native tools for work → open round 2 with a fairly armed managed comparison.
- **E2 — upstream structured output.** FFF ships `structuredContent`/typed results for `grep`/`multi_grep` (passes through the native lane via R10 with zero wrapper change) → rerun the filtering/precision arms against typed results; this is the trigger most likely to flip the shipped-frontend verdict.
- **E3 — frontend competition.** The deferred CLI-first SDK fallback (`agent-session-search native call ...`) is prioritized for any reason → joint evaluation; one composition frontend maximum.
- **E4 — demand signal.** A real task arrives that the managed lane plus the recipe demonstrably cannot serve; record it as an investigation note and run a targeted gate round on that task.

Failure mode this section exists to prevent: the round-1 verdict silently hardening into "Code Mode was rejected." It was not rejected; the gate was not passed, and one arm of the round was invalid.

## 7. Tests and validation

| Gate | Command | Proves |
| --- | --- | --- |
| Types | `npm run check` | New test file compiles under strict TS. |
| Build | `npm run build` | `dist/native-server.js` exists for the recipe test to spawn. |
| Recipe + native lane | `npm test -- test/native-recipe.test.ts test/native-mcp-smoke.test.ts` | The doc's fenced recipe actually runs against a fixture root; native smoke unaffected. |
| Doc/packaging drift | `npm test -- test/readme.test.ts test/packaging.test.ts` | Managed-first presentation intact; tarball contents unchanged (no `examples/` shipped). |
| Full regression | `npm test` | No managed-lane or policy behavior change (there should be zero `src/` diff). |
| Guardrails | `npm run check:dcg` | Destructive-command protections active before landing. |

Manual: run the recipe block once against a temporary configured root; confirm capabilities-first output, provenance `_meta` on hits, and that stopping the script reaps the spawned server child.

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Recipe rots when FFF presentation text changes | Doc teaches a broken pattern | `test/native-recipe.test.ts` executes the doc's own fenced block; failures surface in CI/pre-commit, and the recipe's warning says text may change. |
| Recipe becomes a de-facto API users depend on | Unplanned compatibility surface | Unsupported-status warning is mandatory doc text asserted by test; supported surfaces named explicitly. |
| Recipe routes agents around the managed lane | Escape-hatch moral hazard (R13's concern, recurring) | Recipe opens by pointing at `search_sessions` first and scopes itself to tasks needing upstream parameters/raw text; native lane's own opt-in and budgets unchanged. |
| Doc-block extraction in the test is brittle | Flaky test | Single fenced block with a stable marker comment; extraction is ~10 lines against an in-repo doc. |
| Gate decision freezes ("Code Mode was rejected") | Lost option value | ADR 0002 records triggers E1–E4 and the not-rejected framing; DESIGN.md bullet links to it. |
| Round-2 sweeps repeat round-1 contamination | Another invalid round | Adoption-sweep doc encodes session-id exclusion, metadata scoping, rubric, recall audit — the council's §6 list, made procedure. |
| Executable-bit fix changes launch instructions | Doc inconsistency | Recipe uses `node dist/native-server.js` with a note; one-line update when the tracked fix lands (referenced, not absorbed). |
| Scope creep toward wrapper-side parsing of presentation text into structures | Violates upstream-owned-schemas boundary; productizes the demonstrated brittleness | Named non-goal; the typed-results ask goes upstream (E2), and only envelope-level JSON is admissible in a future CLI shape. |

## 9. Non-goals (explicit)

- No server-side arbitrary code execution, sandboxed or otherwise (`DESIGN.md` non-goal stands; nothing in this round's evidence challenges the sequencing).
- No `session_search_code` MCP tool on either lane; no raw/native modes on `search_sessions`; managed lane stays one tool.
- No promotion of `.worktrees/code-mode-proto` scripts into the repo.
- No wrapper-side inference of structured output from FFF presentation text; no custom indexing/embeddings/derived stores (ADR 0001).
- No changes to native policy, budgets, or exposure set; no fixing of the three separately tracked eval issues inside this scope.
- No telemetry or usage logging added to any binary.

## 10. Order-changing open questions

1. **Does the maintainer want a tested recipe or a prose-only pattern?** If prose-only, U-B shrinks to a doc edit and the doc-execution test is dropped — cheaper, but the recipe will rot silently. This draft recommends the tested form; it is the difference between documenting evidence and documenting hope.
2. **Is upstream FFF structured output on any near-term roadmap?** If E2 is imminent, consider folding the recipe into round 2 rather than shipping it twice (once against raw text, once against typed results).
3. **Will the CLI-first `native call` fallback be prioritized soon?** If yes, write the recipe against that transport instead of the MCP SDK — the composition lesson transfers, and it avoids shipping two transports for one pattern (E3 fires immediately).
4. **Is mode-664 a release defect or a worktree artifact?** Council evidence suggests installed bins are 777/775; the answer (owned by Session A) decides whether the recipe's launch instruction is temporary or permanent.

## 11. Preserved disagreements

- **Against a "defer everything" draft position:** deferring the doc discards the round's only clean win and forfeits the cheap option value of a pattern that agents will otherwise re-derive badly. Feasibility evidence fully funds a doc; it funds nothing more.
- **Against a "start typed-output implementation now" draft position:** a wrapper-side JSON/typed result mode is the parsing brittleness that just failed, promoted into product code, and it crosses the upstream-owned-schemas boundary the two-lane plan pinned. The correct venue is an upstream FFF request plus the native lane's existing `structuredContent` pass-through (R10). The only admissible local variant is envelope-level JSON in a future CLI shape, and only at round 2.
- **Against reading the adoption null as gate failure:** one day of observation is not a usage study. The gate is open, not failed — and the ADR must say so, or this round's verdict will be misquoted as a rejection.
