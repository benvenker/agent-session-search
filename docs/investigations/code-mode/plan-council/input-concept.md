# Code Mode (`session_search_code`) — Plan Council Input Concept

- Date: 2026-07-18
- Status: resolved concept for the Code Mode plan council
- Supersedes nothing; builds on `docs/investigations/fff-pass-through/2026-07-16-code-mode-synthesis.md`

## The decision to plan

Whether — and in what form — the agent-session-search product should proceed with Code Mode (`session_search_code`), per R12 of `docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md`:

> A `session_search_code` Code Mode frontend is evaluated only after native-lane usage shows programmable fanout, pagination, and result filtering justify it.

This is a **gate evaluation**, not a foregone implementation. A legitimate plan outcome is "do not implement now" (with follow-ups), "implement as documented client-side pattern only", "defer pending X", or "implement a shipped tool".

## Evidence artifacts (read all three; they are the ground truth)

1. **Digest brief** — `docs/investigations/code-mode/2026-07-18-digest-brief.md`
   - Established: no organic native-lane usage evidence exists (lane shipped 2026-07-17); the prototype is the evidence-gathering step. Defines the falsifiable gate criteria (fanout replacement ≥5 calls on ≥2 tasks; ≥50% byte savings on ≥2 tasks; pagination value on ≥1 task; precision; ~150 LOC ergonomics ceiling; failure-mode dominance).
2. **Prototype findings** — `docs/prototypes/findings/2026-07-18-code-mode-client-side-prototype.md`
   - Client-side generated TypeScript (`@modelcontextprotocol/sdk` Client + StdioClientTransport over `node dist/native-server.js`) in the throwaway worktree `.worktrees/code-mode-proto` (scripts preserved there for review; not for merge).
   - Headline measurements: 88-LOC shared script; 13 native calls/task replacing 7+ sequential manual calls; >90% byte reductions on 3/5 tasks with decisive evidence preserved; pagination surfaced extra decisive hits on 2 tasks; 0 organic adoption hits; 0 R13-verdict hits; raw presentation-text parsing dominated interpretation; direct-bin EACCES (mode 664) friction confirmed; no budget/timeout/4MiB failures in 65 calls.
   - Prototype's own R12 read: **do not productize `session_search_code` yet**; value looks like an advanced-agent pattern pending structured outputs and packaging ergonomics.
3. **Findings-council report** — `docs/investigations/code-mode/2026-07-18-prototype-findings-council.md`
   - Four-model stress-test (kimi-k3, codex-5.6-sol-x-high, claude-fable-5, codex-5.6-sol-high) of what the prototype actually proved, with a per-criterion verdict table and an explicit R12 evidence-strength assessment FOR and AGAINST.

## Hard constraints (violating any of these rejects the plan)

- **FFF-as-core (ADR 0001):** Code Mode must extend/amplify FFF through the existing router/native lane; never re-implement search, never add custom indexing/embeddings/derived stores.
- **No server-side arbitrary code execution.** DESIGN.md non-goal. Any shipped surface must be client-side composition or a constrained, reviewed execution model — and the latter requires overcoming the non-goal explicitly, which a plan should be very hesitant to recommend.
- **Managed lane stays one tool.** `search_sessions` contract untouched; no raw/native modes added to it.
- **Native policy stays fail-closed.** Code Mode must not become an exposure-path bypass.
- **Prototype code is throwaway.** No plan unit may "promote" `.worktrees/code-mode-proto` scripts into src/; the findings doc's promotion recommendation is "do not promote".

## What the plan MUST decide (explicit sections required)

1. **R12 gate recommendation** — proceed / proceed-as-documented-pattern / defer / decline, tied to measured evidence and the council's evidence-strength assessment, not vibes. If the evidence is deemed insufficient, say what evidence would change the verdict and how it will be gathered.
2. **Implementation shape** (if any): where it lives (managed lane? native-lane companion? third binary? docs-only pattern?), execution model, trust story, relationship to the deferred CLI-first SDK fallback (`agent-session-search native call ...`), and what upstream prerequisites (e.g. typed/structured native results, packaging fixes) gate which shapes.
3. **Implementation venue** — whether implementation (if any) proceeds in a git worktree, with reasoning.
4. **Evidence maintenance** — how R12 evidence keeps accumulating (organic usage observation, instrumentation, revisit triggers, follow-up prototype rounds) so the decision doesn't freeze on one prototype round.

## Known adjacencies the plan must not silently absorb

- The three confirmed native-lane eval issues (bin modes 664, `shownLeadCount` shape, doctor multi_grep false-green) are tracked separately (Session A / Beads). The plan may reference them as prerequisites (packaging friction matters to any client-side pattern) but must not expand into fixing them.
- The CLI-first SDK fallback remains the deferred alternative frontend; Code Mode planning should state the relationship rather than ignore it.
