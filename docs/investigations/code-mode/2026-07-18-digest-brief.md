# Code Mode Digest Brief — 2026-07-18

## 1. What Code Mode means here

The prior synthesis separated two meanings that can both be called "Code Mode":

1. **Client-side generated TypeScript against MCP servers.** Anthropic's pattern is that the agent/client writes ordinary code that calls MCP tools through their schemas, using code as the composition layer rather than asking the MCP server to execute arbitrary code. The prior synthesis explicitly treated this as the safer first Code Mode shape and placed it after the native lane prototype sequence (`docs/investigations/fff-pass-through/2026-07-16-code-mode-synthesis.md:21-23`, `docs/investigations/fff-pass-through/2026-07-16-code-mode-synthesis.md:49-63`).
2. **Server-side Code Mode.** Cloudflare's Code Mode is a server-side single-code-tool pattern. The prior synthesis called it legitimate but not the right first move for this local stdio package because it would import sandboxing/infrastructure work before proving the native lane needs it (`docs/investigations/fff-pass-through/2026-07-16-code-mode-synthesis.md:21-22`, `docs/investigations/fff-pass-through/2026-07-16-code-mode-synthesis.md:49-52`).

This pipeline should prototype **client-side generated TypeScript against the native MCP server**, specifically `agent-session-search-native-mcp`. The plan's deferred-work bullet says the first Code Mode prototype should be "client-side generated TypeScript against the native server" in a throwaway worktree, while server-side sandboxed execution stays out of scope (`docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md:118-123`). `DESIGN.md` makes arbitrary code execution a non-goal (`DESIGN.md:19-30`) and later narrows "read-only Code Mode" to a possible small typed API only if composing lower-level operations clearly beats the managed one-tool surface (`DESIGN.md:163-170`).

`session_search_code` is therefore an **open design space**, not a decided feature. It could mean either:

- a managed-lane MCP tool that accepts code or a constrained expression language and executes it under a reviewed local trust/sandbox model; or
- a documented client-side pattern where an agent writes TypeScript that uses `@modelcontextprotocol/sdk` to connect over stdio to `agent-session-search-native-mcp` and call `fff_grep`, `fff_multi_grep`, and `fff_native_capabilities` directly.

For this pipeline, the prototype target is the second shape: **client-side TypeScript as the programmable composition layer over the built native server**. Do not assume a shipped `session_search_code` MCP tool.

## 2. Current state of the union

What shipped yesterday:

- The native lane landed in git as `fdf57b8 feat(fff): add opt-in native MCP lane (U5-U6)`, preceded by `3b60d89 feat(fff): add capability router and fail-closed native policy`; current main is `00c50e8 docs(adr): record FFF-as-core canon and native policy loosening path` (observed via `git log --oneline --since="2026-07-15" -- docs/ src/ | head -40`).
- The product now has a managed MCP server, a managed `search_sessions` tool, an opt-in native MCP server, CLI, and doctor binary (`DESIGN.md:5-18`). `package.json` maps the native binary name `agent-session-search-native-mcp` to `dist/native-server.js` (`package.json:16-21`).
- The native server exposes `fff_native_capabilities` plus policy-approved mirrored FFF tools. The eval observed exactly `['fff_grep', 'fff_multi_grep', 'fff_native_capabilities']` on the native lane and exactly `['search_sessions']` on the managed lane (`docs/investigations/fff-pass-through/evals/2026-07-17-native-lane-eval.md:9-16`, `docs/investigations/fff-pass-through/evals/2026-07-17-native-lane-eval.md:31-38`).
- ADR 0001 canonizes FFF as the core engine: this package amplifies FFF rather than reimplementing search behavior, with the managed lane adding query rewriting/fanout/merging/warnings and the native lane adding source selection, root-wide coverage, and raw presentation pass-through (`docs/adr/0001-fff-core-and-native-policy-strictness.md:6-14`, `docs/adr/0001-fff-core-and-native-policy-strictness.md:28-41`).
- The fail-closed policy baseline fingerprints full upstream tool definitions; unknown tools and definition drift stay hidden until reviewed (`docs/adr/0001-fff-core-and-native-policy-strictness.md:16-19`, `docs/adr/0001-fff-core-and-native-policy-strictness.md:33-41`). `find_files` is classified internal-only, while `grep` and `multi_grep` are classified both `internal` and `exposable` with local result defaults/ceilings (`src/fff-native-policy.ts:205-227`).

Router API surface as shipped:

```ts
export type RouterSourceInfo = {
  name: SourceName;
  root: string;
  include?: string[];
  status: ResolvedSessionSource["status"];
  warning?: string;
};

export type RouterCallResult = {
  source: SourceName;
  root: string;
  tool: string;
  result: CallToolResult;
};

export type FffCapabilityRouterOptions = {
  sources: ResolvedSessionSource[];
  clientForRoot(root: string): Promise<FffClient>;
};

class FffCapabilityRouter {
  listSources(): RouterSourceInfo[];
  getWarnings(): SearchWarning[];
  listTools(source?: SourceName): Promise<Tool[]>;
  call(source: SourceName, tool: string, args?: Record<string, unknown>): Promise<RouterCallResult>;
}
```

Those signatures come from `src/fff-capability-router.ts:6-24`, `src/fff-capability-router.ts:39-53`, and `src/fff-capability-router.ts:82-86`. The router snapshots sources in the constructor (`src/fff-capability-router.ts:30-37`), clones `listSources` results (`src/fff-capability-router.ts:39-47`), discovers tools through the first healthy source if no source is provided (`src/fff-capability-router.ts:53-80`), and routes `call` to one source-bound FFF client while returning the raw `CallToolResult` envelope inside `RouterCallResult` (`src/fff-capability-router.ts:82-99`).

Native server behavior relevant to a code-mode client:

- **Startup snapshot:** `main()` resolves session roots once, creates one backend pool/router for those sources, creates the native server, then connects over stdio (`src/native-server.ts:125-138`). `buildNativeCatalog()` calls `router.listSources()` once and discovers tools from the healthy sources before serving the stable tool catalog (`src/native-server.ts:150-202`).
- **Source enum:** projected native schemas add a required `source` property with enum values from approved source names (`src/fff-native-policy.ts:394-423`), and the native server rejects calls whose source is not approved for that tool (`src/native-server.ts:96-119`).
- **Budget limits:** constants are 256 attempted calls, 4 concurrent calls, 50 default max results, 200 max results ceiling, and 4 MiB serialized result size (`src/fff-native-policy.ts:7-14`). `NativeCallBudget` also imposes a 15s timeout (`src/fff-native-policy.ts:463-518`). The capabilities diagnostic reports these exact budgets (`src/native-server.ts:250-258`).
- **Result shape:** successful calls preserve upstream result fields and add a collision-checked `_meta['dev.benvenker.agent-session-search/native']` containing source, root, and upstream tool (`src/fff-native-policy.ts:521-543`). Native tool descriptions warn that raw FFF presentation text is returned with no managed ranking/truncation/include filtering/canonical-path rewriting (`src/native-server.ts:186-192`).
- **Coverage and refresh:** diagnostics report root-wide native coverage next to managed include patterns and say config/schema changes require restarting the MCP server (`src/native-server.ts:259-289`). `DESIGN.md` also states native source binding is root-wide and managed `include` patterns are not a native-lane security boundary (`DESIGN.md:72-79`).
- **SDK dependency available to a prototype:** the repo has `@modelcontextprotocol/sdk` `^1.29.0` installed as a production dependency (`package.json:49-52`). The native server itself uses low-level `Server`, `ListToolsRequestSchema`, `CallToolRequestSchema`, and `StdioServerTransport` from that SDK (`src/native-server.ts:1-11`).

Known rough edges from the eval, relevant only if a prototype spawns bins directly or compares docs to live output:

1. Built `dist/` bin targets had mode `664`, so direct command execution failed with permission denied even though `node dist/...` worked (`docs/investigations/fff-pass-through/evals/2026-07-17-native-lane-eval.md:46-64`).
2. `shownLeadCount` was documented/capabilities-shown as a relation object but live CLI/MCP returned a scalar (`docs/investigations/fff-pass-through/evals/2026-07-17-native-lane-eval.md:65-80`).
3. Doctor reported `multi_grep` healthy while live managed searches demoted it with `multi_grep_recall_probe_failed` (`docs/investigations/fff-pass-through/evals/2026-07-17-native-lane-eval.md:82-96`).

## 3. R12 entry-gate assessment (BE BRUTALLY HONEST)

R12 gates Code Mode and a CLI/importable SDK on prototypes demonstrating enough value and solving execution/module-resolution constraints (`docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md:83-86`). The deferred-work bullet is sharper: evaluate `session_search_code` only after native-lane usage shows programmable fanout, pagination, and result filtering justify it (`docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md:118-123`).

Actual evidence inventory:

| Evidence source | What was checked | Result |
| --- | --- | --- |
| Git history | `git log --oneline --since="2026-07-15" -- docs/ src/ | head -40` | Native lane landed in source/docs on 2026-07-17 (`3b60d89`, `fdf57b8`) and was evaluated/docs-amended after. This proves recent implementation/evaluation, not organic usage. |
| CASS exact search | `cass search "fff_grep" --workspace /data/projects/agent-session-search --json --fields minimal --limit 10` | Timed out after 60s in this environment. no evidence found. |
| CASS phrase search | `cass search "native lane" --workspace /data/projects/agent-session-search --json --fields minimal --limit 10` | Timed out after 60s in this environment. no evidence found. |
| Managed session search fallback | `search_sessions`/FFF search for `fff_grep`, `fff_multi_grep`, `native lane`, `session_search_code` across configured sources | Returned this current digest session, the 2026-07-16 planning/eval sessions, docs/eval/planning references, and older unrelated "native/lane" hits. no evidence found for organic post-ship agents using native lane for fanout, pagination, or filtering. |
| CM procedural memory | `cm context "Code Mode session_search_code planning" --json` | Relevant bullets say to include validation commands/test scenarios in complex design docs and to prioritize the router abstraction/use raw SDK for native servers; CM also reported CASS degraded by timeout. It provided no organic native-lane usage evidence. |
| Eval report | Native lane eval observed tool availability, boundary enforcement, root-wide coverage, and three rough edges (`docs/investigations/fff-pass-through/evals/2026-07-17-native-lane-eval.md:9-16`, `docs/investigations/fff-pass-through/evals/2026-07-17-native-lane-eval.md:31-38`, `docs/investigations/fff-pass-through/evals/2026-07-17-native-lane-eval.md:46-100`) | This is controlled evaluation evidence, not organic use evidence. |

Conclusion: **the R12 usage gate does not pass on organic evidence today.** The native lane shipped 2026-07-17, and there is no evidence found that agents have organically used `fff_grep`/`fff_multi_grep` for programmable fanout, pagination, or result filtering since then. Therefore the next prototype should be framed as a **gate-evaluation experiment**, not as the first implementation step of a foregone `session_search_code` feature.

Concrete meaning of "justify" for the prototype:

- **Fanout replacement:** at least two experiment tasks where one generated TypeScript block replaces at least 5 sequential managed/native MCP tool calls while producing equal or better answerable evidence.
- **Token/byte savings:** at least two tasks where client-side filtering/aggregation cuts agent-context bytes by at least 50% versus handing the managed/native lane's unfiltered presentation results to the agent, without dropping the decisive evidence.
- **Pagination value:** at least one task where code-driven cursor pagination across sources finds evidence that a single managed-lane page would not surface, and where doing the same manually would require enough sequential calls to be error-prone.
- **Precision:** generated-code results should have visibly higher precision for the task than raw native output because code can post-filter by path, date/session metadata, nearby tokens, or simple structural tests.
- **Ergonomics ceiling:** prototype client code should stay small enough for an agent to generate/read/debug in one turn. A rough threshold: under ~150 lines per battery task or a reusable helper under ~200 lines plus task-specific snippets under ~50 lines. If presentation-text parsing dominates the code, that is negative evidence.
- **Failure evidence:** if budget exhaustion, 4 MiB ceiling, direct-bin execution, SDK connection setup, or raw text parsing repeatedly dominate the task, the experiment should record that as evidence against productizing Code Mode now.

## 4. Prototype mandate

Prototype shape:

- Use a **throwaway prototype worktree**, following `docs/agents/prototyping.md`: experiments run outside durable product code, findings go to `docs/prototypes/findings/`, and scratch scripts/harnesses are not kept unless promoted as a documented repeatable tool (`docs/agents/prototyping.md:5-21`, `docs/agents/prototyping.md:23-45`).
- Build the repo first, then write client-side TypeScript script(s) using `@modelcontextprotocol/sdk` `Client` over stdio to launch or connect to the **built** native server (`agent-session-search-native-mcp` / `dist/native-server.js`). If the executable-bit eval issue still exists, launch through `node dist/native-server.js` and record that as a prototype ergonomics failure mode rather than fixing production code inside the prototype.
- Each script should first call `fff_native_capabilities`, inspect the available sources/tool budgets, then exercise:
  1. programmable multi-source fanout,
  2. client-side cursor pagination,
  3. client-side filtering/aggregation over raw FFF presentation text.
- Compare every task against the managed lane (`search_sessions`) and against manual native-tool calls where practical. The comparison is not "can code do it?"; it is "does code do materially better than the managed/native MCP tools an agent already has?"

Experiment battery candidates:

1. **Native-lane adoption evidence:** Find sessions since 2026-07-17 where an agent actually called `fff_grep` or `fff_multi_grep` for work rather than only reading docs/evals. Expected evidence: tool-call transcript lines, MCP tool names, or native capability output attached to a non-eval task.
2. **R13/correctness gate archaeology:** Find sessions where the managed-lane correctness track was declared landed, deferred to Beads, or accepted as tracked. Expected evidence: phrases like `R13`, `managed-lane correctness`, `multi_grep_recall_probe_failed`, `parser fidelity`, or Beads references in planning/implementation sessions.
3. **Low-level SDK viability:** Find sessions or code-review notes where `@modelcontextprotocol/sdk` low-level `Server`/`Client`, `StdioServerTransport`, `ListToolsRequestSchema`, or `CallToolRequestSchema` caused problems or was confirmed viable. Expected evidence: implementation/eval notes tied to native server setup.
4. **Packaging friction check:** Find evidence of direct bin execution failures or global-install/module-resolution friction for `agent-session-search-native-mcp`, `dist/native-server.js`, `@modelcontextprotocol/sdk`, or `package.json` `bin`. Expected evidence: permission denied, mode 664, global install, `node dist/...` workaround, import errors.
5. **Root-wide coverage/privacy evidence:** Find discussions warning that native source binding is root-wide and managed `include` is not a native security boundary. Expected evidence: design/eval sessions or user-facing doc review that mention sensitive sibling files, include patterns, or root-wide coverage.

Measure per task:

- number of MCP/tool calls issued by the generated code;
- bytes/tokens returned to the agent context before and after client-side filtering;
- precision of retained evidence (decisive hits divided by retained hits, even if hand-scored);
- whether pagination changed the answer versus a single page;
- generated client-code complexity: LOC, helper count, schema assumptions, parsing brittleness;
- failure modes: native budget exhaustion, 4-concurrent limit, 15s timeout, 4 MiB ceiling, executable-bit issue, SDK connection/setup friction, raw presentation-text parsing burden, and any inability to compare fairly against managed `search_sessions`.

Explicitly out of scope:

- server-side sandboxed execution;
- arbitrary code execution in the product server;
- shipping or editing anything in `src/`;
- merging prototype scripts as production code;
- designing the final implementation plan or creating Beads directly from prototype output.

Required prototype deliverable: a findings document in `docs/prototypes/findings/` that records what was tested, what changed the team's mind, remaining uncertainty, and whether any script/harness deserves promotion under the prototype lifecycle rules (`docs/agents/prototyping.md:5-12`, `docs/agents/prototyping.md:23-45`).

## 5. Open questions the plan drafts must answer

- Where, if anywhere, does `session_search_code` live: a managed-lane MCP tool, a separate third binary, a native-lane companion, or no shipped feature at all?
- Is Code Mode a product feature or a documented client-side pattern for advanced agents using the native MCP lane?
- What is the execution model? If code executes outside the server in the agent's worktree, what docs/guardrails are enough? If code executes inside a server, what sandbox/trust story overcomes `DESIGN.md`'s arbitrary-code non-goal (`DESIGN.md:19-30`)?
- How does Code Mode relate to the CLI-first SDK fallback that the plan deferred because global installs do not provide library exports/declarations (`docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md:118-123`, `docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md:300-309`)?
- Does `@modelcontextprotocol/sdk` `Client` over stdio give enough agent ergonomics from a throwaway TypeScript script, or should the product expose a CLI-native call API instead?
- What token economics beat the managed lane? Define thresholds for when client-side filtering offsets extra code, raw FFF verbosity, and repeated native calls.
- What typed or semi-typed result contract would code consume? Current native results are raw FFF presentation text, and the wrapper deliberately does not infer structured output (`src/native-server.ts:186-192`; `docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md:124-125`).
- How should budgets apply to a code pattern: per native MCP process, per generated script, per task, or per agent session?
- Can the client-side code safely and reliably use cursor pagination across multiple sources without losing provenance or exceeding the 4 MiB result ceiling?
- What is the fallback when CASS or session indexes are degraded/time out, as happened during this digest's CASS checks?
- Does Code Mode remain explicitly read-only, or can any future broader MCP capability reopen mutating-tool policy questions? ADR 0001 and `fff-native-policy.ts` currently keep read-only exposure as a reviewed local policy property (`docs/adr/0001-fff-core-and-native-policy-strictness.md:28-41`, `src/fff-native-policy.ts:237-290`).

## 6. Source index

| Source | Why it matters |
| --- | --- |
| `docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md` | Defines the two-lane plan, R12 gate, deferred Code Mode wording, alternatives considered, budgets, and prototype constraints. |
| `docs/adr/0001-fff-core-and-native-policy-strictness.md` | Canonizes FFF-as-core and records fail-closed native policy plus the future name-allowlist escape hatch. |
| `docs/investigations/fff-pass-through/2026-07-16-code-mode-synthesis.md` | Prior synthesis to build on: router first, native lane before Code Mode, Anthropic/Cloudflare distinction, SDK friction. |
| `src/fff-capability-router.ts` | Shipped router API and behavior: source snapshot, tool discovery, raw source-bound calls. |
| `src/fff-native-policy.ts` | Shipped native exposure policy, approved tools, source projection, validation, budgets, metadata, and fail-closed reasons. |
| `src/native-server.ts` | Shipped native MCP server: low-level SDK surface, startup snapshot, diagnostics, tool catalog, call routing, root-wide notes. |
| `docs/investigations/fff-pass-through/evals/2026-07-17-native-lane-eval.md` | Council evaluation of the shipped native lane, including confirmed tool surface and three rough edges. |
| `DESIGN.md` | Product contract, two-lane boundary, arbitrary-code non-goal, root-wide native warning, deferred Code Mode idea. |
| `docs/agents/prototyping.md` | Prototype lifecycle and promotion rules: throwaway scripts, durable findings, plan-before-Beads requirement. |
| `package.json` | Confirms `agent-session-search-native-mcp` bin and `@modelcontextprotocol/sdk` version available for client-side TS prototype. |
