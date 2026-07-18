date: 2026-07-18
question: Does client-side generated TypeScript against `agent-session-search-native-mcp` demonstrate that programmable fanout, pagination, and result filtering justify a Code Mode frontend (`session_search_code`)?
prototype_location: /data/projects/agent-session-search/.worktrees/code-mode-proto/prototype-code-mode
verdict: Mixed evidence. The client-side SDK script was viable and compact, and it clearly demonstrated programmable fanout, cursor pagination, and large byte reductions before evidence reaches the agent. It did **not** justify productizing `session_search_code` now: the strongest task, native-lane adoption, still found no hand-scored organic adoption evidence; raw FFF presentation-text parsing produced brittle false positives; and the direct-bin mode-664 friction remains real. Treat this as evidence for an advanced-agent pattern or future typed CLI/helper, not as a green light for a Code Mode frontend.

## What was tested

Prototype code was written only under:

- `/data/projects/agent-session-search/.worktrees/code-mode-proto/prototype-code-mode/README.md`
- `/data/projects/agent-session-search/.worktrees/code-mode-proto/prototype-code-mode/probe.ts`
- `/data/projects/agent-session-search/.worktrees/code-mode-proto/prototype-code-mode/call-probe.ts`
- `/data/projects/agent-session-search/.worktrees/code-mode-proto/prototype-code-mode/run-battery.ts`
- raw run artifacts in `/data/projects/agent-session-search/.worktrees/code-mode-proto/prototype-code-mode/out/`

Durable finding only is this document in the planning worktree.

Battery run by `npx tsx prototype-code-mode/run-battery.ts` from `/data/projects/agent-session-search/.worktrees/code-mode-proto`:

1. Native-lane adoption evidence since 2026-07-17.
2. R13 / managed-lane correctness archaeology.
3. Low-level `@modelcontextprotocol/sdk` viability.
4. Packaging friction: direct bin execution, global install, module-resolution notes.
5. Root-wide coverage / privacy boundary warnings.

Arms per task:

- **Managed lane:** `node dist/cli.js "<query>" --json`.
- **Manual native:** one first-page `fff_multi_grep` call per healthy source, as an agent would issue tool-by-tool.
- **Generated client-side TS:** a script using `Client` + `StdioClientTransport` from `@modelcontextprotocol/sdk`, spawning `node dist/native-server.js`, then doing source fanout, cursor pagination, parsing raw presentation text, and client-side filtering.

Environment observed from live `fff_native_capabilities`:

- sources: `codex`, `claude`, `pi`, `cursor`, `hermes`, `gemini`, `omp`; all `status: ok`.
- lane: `native-fff`; entrypoint: `agent-session-search-native-mcp`; policy version: `1`.
- budgets: 256 attempted calls/process, 4 concurrent, 50 default results, 200 max results, 4,194,304 max serialized result bytes.
- coverage: `root-wide`; capabilities notes say native calls inspect canonical roots, not managed include patterns.
- direct built bin check: `dist/native-server.js` mode `664`; `./dist/native-server.js` failed with `EACCES`; `node dist/native-server.js` worked.

## Measurements

Numbers are from `/data/projects/agent-session-search/.worktrees/code-mode-proto/prototype-code-mode/out/metrics.json` from the refined run at `2026-07-18T01:42:53.510Z`. “Retained” is the automated lexical filter’s retained hit count. “Hand decisive” is my post-run scoring against the battery’s actual evidence target, because raw presentation text produced plausible-looking but off-target lexical hits.

| Task | Arm | Calls | Bytes before | Bytes after filter | Byte reduction | Retained | Hand decisive / retained | Pagination effect | LOC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Native adoption | managed | 1 | 38,155 | 2 | 99.99% | 0 | 0/0 | no follow-up page tested | n/a |
| Native adoption | manual native | 7 | 9,220 | 336 | 96.36% | 1 | 0/1 | first page only | n/a |
| Native adoption | generated TS | 13 | 25,739 | 961 | 96.27% | 3 | 0/3 | 2 retained lexical hits appeared only after pagination, but neither proved organic adoption | 88 total |
| R13 correctness archaeology | managed | 1 | 40,638 | 2 | 99.99% | 0 | 0/0 | no follow-up page tested | n/a |
| R13 correctness archaeology | manual native | 7 | 13,408 | 2 | 99.99% | 0 | 0/0 | first page only | n/a |
| R13 correctness archaeology | generated TS | 13 | 28,046 | 493 | 98.24% | 2 | 0/2 | 2 retained lexical hits appeared only after pagination, but they were fallback-warning lines, not a landed/deferred/accepted R13 verdict | 88 total |
| SDK viability | managed | 1 | 40,792 | 2 | 99.99% | 0 | 0/0 | no follow-up page tested | n/a |
| SDK viability | manual native | 7 | 13,167 | 555 | 95.78% | 2 | 2/2 | first page only | n/a |
| SDK viability | generated TS | 13 | 29,221 | 1,086 | 96.28% | 4 | 4/4 | 2 additional retained hits appeared after pagination | 88 total |
| Packaging friction | managed | 1 | 40,561 | 2 | 99.99% | 0 | 0/0 | no follow-up page tested | n/a |
| Packaging friction | manual native | 7 | 16,580 | 354 | 97.86% | 1 | 1/1 | first page only | n/a |
| Packaging friction | generated TS | 13 | 32,549 | 2,619 | 91.95% | 8 | 3/8 | 7 retained lexical hits appeared after pagination; useful hits included global/module-resolution planning, but several were generic native-binary mentions | 88 total |
| Root-wide/privacy | managed | 1 | 39,480 | 2 | 99.99% | 0 | 0/0 | no follow-up page tested | n/a |
| Root-wide/privacy | manual native | 7 | 11,242 | 329 | 97.07% | 1 | 1/1 | first page only | n/a |
| Root-wide/privacy | generated TS | 13 | 26,229 | 623 | 97.63% | 2 | 2/2 | 1 additional retained hit appeared after pagination | 88 total |

Additional measured facts:

- The generated script made 65 native MCP calls across the five task arms, plus one initial `fff_native_capabilities` call; no native budget exhaustion, timeout, concurrency-limit, or 4 MiB result-ceiling failure occurred.
- `run-battery.ts` was 88 lines after the refined run, below the digest’s ~150 LOC per-task ergonomics ceiling. That is one shared script for all five tasks, not five separate polished task implementations.
- Raw artifacts were written under `prototype-code-mode/out/*-{managed,manual-native,generated}.json` and `prototype-code-mode/out/metrics.json`.

## Gate-criteria verdicts

| Criterion from digest §3 | Verdict | Evidence |
| --- | --- | --- |
| Fanout replacement: generated TS replaces at least 5 sequential managed/native MCP calls on at least 2 tasks while preserving answerability. | **Supported mechanically; insufficient product evidence.** | Generated TS issued 13 native calls on every task, replacing the manual pattern of 7 sequential first-page source calls plus pagination follow-ups. It preserved answerability on SDK viability, packaging friction, and root-wide/privacy. It did not produce decisive evidence for adoption or R13. |
| Token/byte savings: at least 2 tasks cut agent-context bytes by at least 50% without dropping decisive evidence. | **Supported on 3 tasks.** | Generated TS reductions with decisive evidence preserved: SDK 29,221 → 1,086 bytes (96.28%, 4/4 hand decisive), packaging 32,549 → 2,619 bytes (91.95%, 3/8 hand decisive), root-wide 26,229 → 623 bytes (97.63%, 2/2 hand decisive). Adoption and R13 reductions were not meaningful because no decisive target evidence remained. |
| Pagination value: at least 1 task where code-driven cursor pagination finds evidence a single page would not surface. | **Supported, but modest.** | Generated pagination surfaced hand-decisive additional hits on SDK viability (2 additional), packaging friction (some useful additional hits among 7 lexical additions), and root-wide/privacy (1 additional). Adoption and R13 pagination added false positives or non-target evidence. |
| Precision: generated-code results should visibly improve precision over raw native output. | **Mixed.** | For SDK and root-wide/privacy, generated filtering retained only hand-decisive hits (4/4 and 2/2). Packaging retained 8 but only 3 were hand-decisive. Adoption and R13 retained 3 and 2 lexical hits, with 0 hand-decisive. Filtering improved byte volume, but semantic precision still depended on human review. |
| Ergonomics ceiling: under ~150 LOC per battery task, or helper under ~200 lines plus small task snippets. | **Supported.** | `run-battery.ts` is 88 lines and handles connect, capabilities, managed comparison, manual native first pages, generated fanout, pagination, filtering, byte measurement, and raw artifact capture. SDK setup was straightforward once using `node dist/native-server.js`. |
| Failure-mode dominance: budget exhaustion, 4 MiB ceiling, bin execution, SDK setup, or raw parsing repeatedly dominate. | **Mixed / cautionary.** | No budget, timeout, concurrency, or 4 MiB failures occurred. Direct bin execution failed (`mode 664`, `EACCES`), exactly as the digest warned. Raw presentation-text parsing and lexical filtering dominated interpretation: several retained hits were not actually decisive. |

## What changed our mind

- The low-level SDK path is less scary than expected. `Client` + `StdioClientTransport` connected to `node dist/native-server.js` cleanly, and `client.callTool({ name, arguments })` was enough for all arms.
- Code-side filtering did cut bytes dramatically, but byte savings alone were misleading. The hard part was not transport; it was deciding whether raw FFF presentation snippets actually answered the design question.
- Cursor pagination worked and found more hits, but “more” often meant more lexical noise. Pagination was useful for SDK/root-wide evidence and mixed for packaging; it did not rescue adoption or R13.
- The managed lane’s first-page candidate output was often dominated by current/prototype-session contamination for these exact queries. That is evidence for better query scoping/follow-up ergonomics, not automatically evidence for a Code Mode product surface.
- Organic native-lane adoption still did not appear. The prototype’s own native calls would have contaminated the result if not excluded; after hand scoring, adoption remained 0 decisive hits.

## Failure modes observed

- **Direct bin friction:** `dist/native-server.js` had mode `664`; direct execution failed with `EACCES`. The prototype used `node dist/native-server.js` and did not fix production permissions.
- **Raw presentation parsing:** FFF text gives path blocks, match lines, and `cursor: N`. Parsing this in generated client code is possible but brittle; path detection failed for some snippets, and semantic scoring required human review.
- **Lexical false positives:** `R13` matched unrelated requirements in other projects; `permission denied` matched generic permission failures; `agent-session-search-native-mcp` matched general design mentions rather than packaging failures.
- **Current-session contamination:** managed results and native searches can surface the prototype/digest sessions themselves. The script added exclusions, but this is easy for generated code to miss.
- **SDK warning:** running through `tsx` emitted Node’s `[DEP0205] module.register()` deprecation warning. It did not block the run.
- **No observed budget failures:** 65 generated native calls plus capabilities stayed below the 256 attempted-call budget; no timeout, 4-concurrent, or 4 MiB ceiling failures occurred.

## What remains uncertain

- Whether a better managed-lane follow-up flow would erase most of the value shown by client-side TS pagination.
- Whether a typed native result format would make Code Mode compelling; this prototype used raw presentation text, which was the main source of brittleness.
- Whether agents would organically use the native lane for real work once they learn it exists. This experiment found no decisive organic adoption evidence.
- Whether packaging friction is only a build artifact in this worktree or a release/publish problem that users would hit after install.
- How much of the measured byte savings would translate into token savings in real agent conversations after summaries, tool elision, and artifacts are involved.

## Promotion recommendation

Do **not** promote the prototype scripts as documented tools. They are useful evidence but too task-specific and too dependent on raw presentation-text heuristics. If anything is promoted later, it should be a small documented native-lane call helper or typed CLI/JSON result mode, not this harness.

## R12 evidence summary

Evidence **for** productizing or at least preserving a Code Mode path:

- Client-side SDK connection to the native MCP lane is viable with installed dependencies.
- One compact 88-line script performed capabilities discovery, source fanout, pagination, filtering, managed comparison, and metrics capture.
- Generated filtering cut raw context bytes by >90% on every task; on SDK, packaging, and root-wide tasks it preserved at least some decisive evidence.
- Cursor pagination found hand-decisive extra evidence on SDK viability and root-wide/privacy, and useful-but-noisy additional packaging evidence.
- No native budget, timeout, concurrency, or 4 MiB ceiling was hit during the battery.

Evidence **against** productizing `session_search_code` now:

- The adoption gate remains negative: 0 hand-decisive organic post-ship native-lane usage hits after excluding prototype/digest contamination.
- R13/correctness archaeology also produced 0 hand-decisive landed/deferred/accepted verdict hits in this run.
- Raw FFF presentation text is not a stable enough contract for a product Code Mode frontend; parsing and hand scoring dominated interpretation.
- Packaging friction is real in the built worktree: direct bin execution failed with `EACCES` due mode `664`.
- The measured value looks like an advanced-agent throwaway pattern, not yet a durable user-facing API.

Overall R12 read: **do not proceed to productizing `session_search_code` yet.** Proceed, if at all, by improving native/managed structured outputs and packaging ergonomics, then rerun a gate experiment with organic usage or a narrower documented client-side recipe.

## Appendix: repro commands

From `/data/projects/agent-session-search/.worktrees/code-mode-proto`:

```sh
# Main battery: runs capabilities, managed arms, manual native arms, generated TS arms, and writes raw artifacts.
npx tsx prototype-code-mode/run-battery.ts

# SDK/tool-shape probe used before the battery.
npx tsx prototype-code-mode/probe.ts

# Raw native call shape/cursor probe used before the battery.
npx tsx prototype-code-mode/call-probe.ts

# Managed-lane arm shape; substitute each battery query from run-battery.ts.
node dist/cli.js "agent-session-search @modelcontextprotocol/sdk low-level Server Client StdioServerTransport CallToolRequestSchema viability problems confirmed viable" --json

# Native server entrypoint used by the client-side SDK transport.
node dist/native-server.js

# Direct-bin friction check performed inside the battery; expected in this worktree: EACCES because mode is 664.
./dist/native-server.js
```
