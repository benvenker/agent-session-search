# Plan Council Draft: FFF Two-Lane Architecture

- Author: kimi-k3
- Concept source: `docs/investigations/fff-pass-through/2026-07-16-code-mode-synthesis.md`
- Status: planning draft (no production code changes implied by this document)
- Format note: structured for direct conversion into a `ce-unified-plan/v1`
  artifact under `docs/plans/` per the repo planning contract; requirements
  below trace to the concept document's corrections and preferred sequence.

## Concept Intent

Keep `search_sessions` as the single managed product lane, and add an opt-in
native lane that exposes FFF's own capabilities through a generic,
source-bound capability router. The durable architectural core is the router
(`listSources` / `listTools` / `call`), not Code Mode: Code Mode is one
possible frontend of that router, to be evaluated only after the router
exists and demonstrates value.

This draft deliberately preserves the concept document's disagreements with
the original two-lane proposal:

- **Automatic discovery, not automatic exposure** (correction 1). New
  upstream tools must be classified (read-only vs. mutating), budgeted, and
  policy-approved before they become callable. `tools/list` output is a
  discovery signal, not an allowlist.
- **Partial parity only** (correction 2). `tools/list` covers MCP tools and
  input schemas. It does not cover new FFF CLI flags, runtime configuration,
  or FFF's presentation-oriented text results. Structured-output fidelity
  remains a separate concern.
- **Code Mode is not foundational** (corrections 3–4). Server-side Code Mode
  (Cloudflare-style Dynamic Workers) is experimental and is a large
  sandboxing project for a local Node/stdio package. It is deferred behind a
  value gate.
- **npm SDK has install friction** (correction 5). The package is normally
  installed globally and publishes no library exports today (`package.json`
  ships only `bin` entries, no `exports`/`main`/`types`). A coding workspace
  cannot reliably import a globally installed package, so the SDK lane is a
  separately gated prototype.

## Recommended Implementation Shape

Five phases, strictly sequenced, mirroring the concept document's preferred
sequence. Phases 1–2 are internal-only and safe to ship behind the existing
one-tool boundary. Phase 3 adds a second, explicitly opt-in binary. Phases
4–5 are prototypes with explicit go/no-go gates and must not land on
mainline without a fresh design pass.

```text
Phase 1  Managed-lane correctness fixes (no new surface)
Phase 2  FffCapabilityRouter (internal, source-bound, policy-gated)
Phase 3  agent-session-search-native-mcp (separate opt-in binary on the router)
Phase 4  GATE: session_search_code frontend evaluation (prototype only)
Phase 5  GATE: CLI/code SDK ergonomics prototype (global-install resolution test first)
```

The router contract, mirroring the concept document:

```ts
type FffCapabilityRouter = {
  listSources(): Promise<RouterSourceInfo[]>;
  listTools(source: SourceName): Promise<FffToolSchema[]>; // full input schemas, not names only
  call(
    source: SourceName,
    tool: string,
    args: unknown
  ): Promise<RawCallToolResult>;
};
```

Key shape decisions:

1. **The router wraps the existing per-root client pool; it does not
   replace it.** `src/client-pool.ts` already keys one `fff-mcp` child per
   source root and owns lifecycle; the router adds capability discovery,
   classification, and policy-gated dispatch on top of the same pool.
2. **Full schemas, not names.** `FffClient.listTools()` in
   `src/fff-backend.ts` currently returns `Promise<string[]>`, and
   `FffMcpClient.listTools()` discards everything except tool names. The
   router needs the complete `inputSchema` per tool so the native lane can
   mirror real upstream signatures without hand-maintained duplication.
3. **Policy gate is explicit and static-by-default.** A checked-in policy
   table maps tool name → classification (`read-only` / `mutating` /
   `unknown`) → allowed in the native lane? Unknown tools discovered at
   runtime are listed (with a warning) but never callable until the table is
   updated. This is the concrete form of "automatic discovery, not automatic
   exposure." The table is anchored to the pinned minimum `fff-mcp` release
   (`REQUIRED_FFF_MCP_RELEASE = "v0.9.6"` in `src/fff-runtime.ts`); the only
   tools this repo depends on today are `grep` and `multi_grep`.
4. **The native lane is a separate entrypoint and binary.**
   `src/server.ts` keeps exposing exactly one tool (`search_sessions`). The
   native server is a new `src/native-server.ts` binary
   (`agent-session-search-native-mcp`) that dynamically registers mirrored
   FFF tools with a required `source` argument. Users opt into upstream
   semantics by configuring the second server; the default install
   experience is unchanged.
5. **Managed lane never depends on the native lane.** Phases 1–2 must ship
   with zero changes to the public `search_sessions` contract; the router is
   consumed by `src/search.ts` internally first, which also proves the
   abstraction before a second frontend is built on it.

## Ordered Implementation Steps

### Phase 1 — Managed-lane correctness fixes

These fix the known strictness/pagination/parser/coverage/`context` problems
the concept document says the two-lane proposal "does not excuse." Exact
bead split is deferred to Beads conversion; representative items:

1. Audit and fix pagination/completeness reporting in `src/search.ts`
   (group `hasMore` semantics, count structures, `more.*` echo payloads).
2. Fix parser-fidelity and coverage-exclusion gaps in
   `src/fff-backend.ts` result adaptation (keep `FffToolResult` close to the
   FFF hit shape; stop dropping fields the response shaping later needs).
3. Clarify `context` behavior: either implement bounded surrounding-line
   reads inside `search_sessions` or explicitly document the field as
   reserved; tests must pin whichever behavior is chosen.
4. Re-run the `multi_grep` recall-equivalence probe and confirm the
   `sequential_grep_fallback` reporting still matches `DESIGN.md`.

### Phase 2 — FffCapabilityRouter (internal)

5. Extend `FffMcpClient.listTools()` in `src/fff-backend.ts` to return full
   tool descriptors (`{ name, description, inputSchema }`) instead of
   `string[]`. Migrate the `FffClient` type and its consumers
   (`src/client-pool.ts`, `OneRootFffBackend`'s `multi_grep` support probe
   at `src/fff-backend.ts`) in the same change, keeping a name-only derived
   view where that is all a consumer needs.
6. Add `src/fff-router.ts`:
   - `createFffCapabilityRouter({ pool, roots, policy })`.
   - `listSources()` from resolved roots (`src/roots.ts`), including
     enabled/disabled state and unreadable-root warnings.
   - `listTools(source)` via the pooled client's full-schema `listTools`,
     with per-source caching keyed to child process lifetime (schema is
     stable for a given `fff-mcp` version; invalidate on client recreation).
   - `call(source, tool, args)` dispatching through the pool, guarded by the
     policy table, with per-call argument validation against the discovered
     `inputSchema` (zod-from-JSON-schema or a manual structural check — pick
     the simpler; zod v4 is already a dependency).
7. Add `src/fff-tool-policy.ts`: static classification table seeded with the
   tools this repo already knows (`grep`, `multi_grep` → read-only/allowed);
   anything else discovered at runtime is classified `unknown` →
   listed-not-callable. Include a `policyVersion` and a test that fails when
   the router discovers an unclassified tool, forcing a conscious
   classification decision on FFF upgrades.
8. Rewire `src/search.ts` / `OneRootFffBackend` to route internal
   `grep`/`multiGrep` calls through the router so the abstraction carries
   real traffic before the native lane exists. This must be
   behavior-neutral (guarded by existing search tests) and land as its own
   isolated change.

### Phase 3 — Native opt-in MCP server

9. Add `src/native-server.ts`: FastMCP server named
   `agent-session-search-native` that at startup calls
   `router.listSources()` + `router.listTools(source)` for each enabled
   source, then registers one mirrored tool per upstream tool with a
   required `source` parameter merged into the upstream `inputSchema`.
   Re-discovery happens on restart/reconnect; keep it simple rather than
   adding live refresh.
10. Wire `call` through the router's policy gate; return raw
    `CallToolResult` content unmodified (pass-through), with the router
    adding only `source`/`root` envelope metadata where it can do so without
    parsing FFF's presentation text.
11. Add `agent-session-search-native-mcp` to `package.json` `bin`; add a
    doctor check in `src/fff-preflight.ts` that the native server starts and
    lists tools.
12. Update `capabilities --json` and `robot-docs` in `src/cli.ts` /
    `src/help.ts` to document the second server as opt-in; `DESIGN.md`
    "Product Contract" section gains the fourth binary with an explicit note
    that the one-tool boundary applies to the default server only.

### Phase 4 — GATE: code frontend prototype

13. Only if router usage data or user demand shows programmable fanout /
    pagination / result filtering is worth it: prototype
    `session_search_code` in a throwaway worktree per
    `docs/agents/prototyping.md`. Server-side sandboxed execution is
    explicitly out of scope for the first prototype (concept correction 4);
    prefer a client-side generated-TypeScript shape (Anthropic pattern) that
    talks to the Phase 3 native server.
14. Record findings in `docs/prototypes/findings/` before any mainline plan.

### Phase 5 — GATE: CLI/code SDK prototype

15. First test the ergonomics premise, not the code: can an arbitrary coding
    workspace resolve a globally installed package's library entrypoint?
    Spike `exports` + `.d.ts` publishing for
    `@benvenker/agent-session-search` and test import from a scratch project
    after a global install. If resolution is unreliable, prefer shipping the
    SDK surface through the CLI (`agent-session-search native call ...`)
    instead of an importable library.

## Files/Modules Likely to Change

| File                        | Change                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `src/fff-backend.ts`        | full-schema `listTools`; expose a raw `callTool` passthrough on `FffClient`            |
| `src/fff-router.ts`         | **new** — `FffCapabilityRouter` implementation                                         |
| `src/fff-tool-policy.ts`    | **new** — static classification/allowlist table + `policyVersion`                      |
| `src/client-pool.ts`        | expose pooled client for router dispatch (no lifecycle change)                         |
| `src/search.ts`             | route internal backend calls through the router (behavior-neutral)                     |
| `src/native-server.ts`      | **new** — opt-in native MCP server entrypoint                                          |
| `src/fff-preflight.ts`      | doctor check for native server startup/tool listing                                    |
| `src/cli.ts`, `src/help.ts` | `capabilities --json` / robot-docs mention of the native lane                          |
| `src/types.ts`              | router-facing types (`FffToolSchema`, `RawCallToolResult`, policy types)               |
| `package.json`              | `bin` entry for `agent-session-search-native-mcp`; `files` unchanged (dist-only)       |
| `DESIGN.md`                 | Product Contract gains the opt-in binary; Deferred Ideas updated (Code Mode/SDK gates) |
| `CONTEXT.md`                | Key Modules list gains `fff-router.ts`, `fff-tool-policy.ts`, `native-server.ts`       |
| `AGENTS.md`                 | MCP surface note updated to name the two servers and the one-tool boundary's scope     |

## Tests and Validation

New tests (vitest, matching existing fake-client patterns in
`test/fff-backend.test.ts` and `test/client-pool.test.ts`):

- `test/fff-router.test.ts` — full-schema `listTools` pass-through; policy
  gate blocks unknown/mutating tools; per-source dispatch reaches the
  correct pooled child; unreadable source produces a warning, not a failure;
  schema cache invalidates when a pooled client is recreated.
- `test/fff-tool-policy.test.ts` — every discovered tool in fixtures is
  classified; an unclassified tool fails the test (upgrade tripwire).
- `test/native-server.test.ts` — server registers mirrored tools with
  required `source`; `call` returns raw upstream content; unknown tool
  requests are rejected with an agent-readable error.
- `test/search.test.ts` (extend) — managed search behavior identical before
  and after the Phase 2 rewiring (golden-shape assertions already present).
- `test/packaging.test.ts` (extend) — the new `bin` entry is built and
  packaged.
- `test/mcp-smoke.test.ts` (extend or sibling) — stdio handshake against the
  native server lists mirrored tools.

Validation commands:

```bash
npm run check
npm test
npm run build
npm run smoke
npm run check:fff
npm run dev:cli -- capabilities --json        # native lane documented
node dist/native-server.js &                  # manual stdio handshake smoke
agent-session-search-doctor                   # reports native-server health
```

End-to-end: configure a scratch MCP client with both servers; confirm the
default server still shows exactly `search_sessions`, and the native server
lists mirrored FFF tools and executes `grep` against a fixture root with
canonical absolute paths in results.

## Risks, Constraints, and Open Questions

Risks:

- **Upstream schema churn.** FFF adding/renaming tools or changing
  `inputSchema` silently changes the native lane's surface. Mitigation: the
  policy tripwire test + `policyVersion`; native lane caches schemas per
  child lifetime and re-discovers on reconnect; `fff-mcp` minimum version is
  already pinned and enforced at startup (`src/fff-runtime.ts`).
- **Scope creep into "automatic exposure."** Any pressure to make discovered
  tools callable without classification breaks the safety model and must be
  rejected at review time.
- **Behavior drift during Phase 2 rewiring.** Routing managed search through
  the new abstraction can subtly change fanout or error semantics.
  Mitigation: behavior-neutral requirement guarded by existing tests; land
  the rewiring as its own commit with no other changes.
- **FastMCP dynamic-tool limitations.** FastMCP may not cleanly support
  registering tools discovered at runtime with arbitrary JSON schemas
  (mirrors the known `outputSchema`/structured-content limitation already
  recorded in `DESIGN.md`). Mitigation: spike tool registration early in
  Phase 3; fallback is a single `fff_call(source, tool, args)` meta-tool on
  the native server — less ergonomic but honest.
- **Presentation-oriented FFF output.** Raw pass-through returns FFF's text
  blocks, which are not typed. The native lane must not promise structured
  results it cannot deliver; document this in tool descriptions.

Constraints:

- The default MCP surface stays one tool (`src/server.ts`); the native lane
  is a separate binary, never a second tool on the default server.
- No custom indexing, embeddings, or session stores (DESIGN.md non-goals);
  "arbitrary code execution" stays a non-goal, which is exactly why
  server-side Code Mode is gated rather than planned.
- Node `>=22.12.0`, ESM, existing dependency set preferred (zod v4,
  fastmcp, MCP SDK already present — no new runtime deps expected for
  Phases 1–3).
- Prototype lifecycle rules: Phases 4–5 findings land in
  `docs/prototypes/findings/`; no prototype code merges to mainline.

Open questions that would change implementation order:

1. **Does FastMCP support runtime-registered tools with arbitrary JSON
   schemas?** If no, Phase 3 falls back to a meta-tool shape, which weakens
   the "mirrored native surface" story and may reprioritize the CLI/SDK lane
   (Phase 5) above Phase 4.
2. **Does FFF expose any mutating tools today or on its roadmap?** If yes,
   the policy table needs a deny-by-default enforcement path with explicit
   human opt-in, which grows Phase 2 scope.
3. **Is there measured demand for programmable fanout?** If
   `search_sessions` correctness fixes (Phase 1) close most escape-hatch
   requests, Phases 4–5 should stay gated indefinitely — the router + native
   lane alone may be the whole product answer.
4. **Should the managed lane consume router capabilities beyond
   grep/multi_grep?** (e.g., using an upstream file-read tool for the
   `context` field.) If yes, Phase 1 item 3 and Phase 2 merge, changing the
   sequence.
5. **Global-install SDK resolution:** if the Phase 5 spike shows import from
   a global install is unreliable across package managers, the SDK concept
   becomes CLI-first and the npm-library shape is dropped.
