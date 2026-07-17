# FFF Two-Lane Architecture — MCP Evaluation Council Synthesis

- Date: 2026-07-17
- Plan under evaluation: `docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md`
- Synthesis agent: kimi-k3 (council synthesizer)
- Council: kimi-k3, codex56SolXHigh, claude-fable-5, codex56SolHigh
- All claimed issues below were independently re-verified by the synthesizer against the built `dist/` artifacts before inclusion.

## Objective Prepare Baseline (tiebreaker)

Build passed. Live MCP probes against the built servers found:

- Managed tools: `["search_sessions"]`
- Native tools: `["fff_grep", "fff_multi_grep", "fff_native_capabilities"]`

No model's evidence conflicts with this baseline on tool availability — all four models observed exactly these tool sets on the correct lanes. The baseline was not needed as a tiebreaker for tool availability.

## Per-Model Scorecards

| Dimension             | kimi-k3 | codex56SolXHigh | claude-fable-5 | codex56SolHigh | Mean     |
| --------------------- | ------- | --------------- | -------------- | -------------- | -------- |
| managedParity         | 10      | 8               | 9              | 10             | 9.25     |
| failClosedCorrectness | 9       | 10              | 9              | 10             | 9.5      |
| boundaryEnforcement   | 10      | 10              | 9              | 10             | 9.75     |
| docsAccuracy          | 9       | 6               | 8              | 10             | 8.25     |
| acceptanceExamples    | 9       | 2               | 9              | 10             | 7.5      |
| **Model average**     | **9.4** | **7.2**         | **8.8**        | **10.0**       | **8.85** |

Note on the outlier: codex56SolXHigh's `acceptanceExamples: 2` and `docsAccuracy: 6` are driven by its two findings (non-executable bin entrypoints make the documented acceptance commands literally fail; `shownLeadCount` documented shape mismatches live output). Both findings were verified as real (see Issues), so the low scores reflect genuine defects that the other three models did not test for, not evaluator error.

## Agreements

- **Tool surface per lane (4/4, matches baseline):** managed server exposes exactly `search_sessions`; native server exposes exactly `fff_grep`, `fff_multi_grep`, `fff_native_capabilities`. Doctor check `native_server_tools` corroborates ("listed 3 tool(s)").
- **Fail-closed source enforcement (4/4):** omitting `source` on `fff_grep` fails with MCP error -32602 ("must have required property 'source'"); a bogus source fails with -32602 ("must be equal to one of the allowed values"). Both rejections happen at argument validation, before any search executes — per plan KTD7/AE2. Valid sources are discoverable at runtime via `fff_native_capabilities` and the schema enum.
- **CLI/MCP envelope parity (4/4):** `node dist/cli.js "<q>" --json` and managed `search_sessions` return the same contract: `contractVersion: "progressive-evidence-groups.v2"`, `resultsShape: "candidate_groups"`, identical `metadata.backend` and per-source warnings.
- **Boundary enforcement (4/4):** no raw/native modes on `search_sessions`; `capabilities --json` keeps native tools out of `mcp.tools` (policy: "Native FFF access is a separate opt-in server, never a mode of search_sessions"); raw FFF presentation text appears only in the native lane; `find_files` is blocked with `policy_not_exposable`.
- **Native capabilities content (4/4):** lane `native-fff`, entrypoint `agent-session-search-native-mcp`, policyVersion 1, supportedFff v0.9.6, root-wide coverage, budgets, 7 healthy sources (claude, codex, cursor, gemini, hermes, omp, pi).

## Disagreements

- **Severity of the bin-permission defect:** only codex56SolXHigh probed the documented commands directly (rather than through `node dist/...`) and found them non-executable; it rated this release-blocking. The other models' `node dist/...` invocations all succeeded. Synthesizer re-verification confirms the underlying fact (see Issue 1), so this is a coverage difference, not a factual conflict.
- **`shownLeadCount` shape:** only codex56SolXHigh compared the documented/example shape against live output. Synthesizer re-verification confirms the mismatch (see Issue 2).
- **Doctor vs runtime multi_grep health:** reported by kimi-k3 and claude-fable-5, not probed by the codex evaluators. Synthesizer re-verification confirms (see Issue 3).
- **Tool availability:** no disagreement; baseline and all models concur.

## Confirmed Issues (deduplicated)

### Issue 1 — High: installed bin entrypoints are non-executable (mode 664)

Reported by: codex56SolXHigh. Independently re-verified by synthesizer.

All four `dist/` bin targets have valid `#!/usr/bin/env node` shebangs but mode 664, so executing them as commands fails with `permission denied` (exit 126). `package.json` `bin` maps `agent-session-search`, `agent-session-search-doctor`, `agent-session-search-mcp`, and `agent-session-search-native-mcp` to these files, so the documented CLI, doctor, and both server commands fail when invoked as commands. MCP configs and the eval harness that launch via `command=node ...` mask the defect, which is why three of four evaluators saw green.

Evidence: `stat -c '%a %n' dist/cli.js dist/fff-preflight.js dist/server.js dist/native-server.js` → all `664` (synthesizer, this repo). codex56SolXHigh additionally observed exit 126 on the globally installed bin.

Repro (copy-pasteable):

```bash
cd /data/projects/agent-session-search
stat -c '%a %n' dist/cli.js dist/fff-preflight.js dist/server.js dist/native-server.js
./dist/cli.js capabilities --json        # permission denied, exit 126
./dist/fff-preflight.js --json           # permission denied, exit 126
```

### Issue 2 — Medium: `shownLeadCount` documented as a relation object but returned as a scalar

Reported by: codex56SolXHigh. Independently re-verified by synthesizer.

`docs/mcp.md` (line 93: "Counts use `{ "value": number, "relation": "eq" | "gte" }`", and the example at line 114) and the `capabilities --json` `defaultCandidateGroups` example both present `shownLeadCount` as `{"value": 1, "relation": "eq"}`. Live CLI and MCP results return a plain scalar (e.g. `"shownLeadCount": 2`) while sibling counts `assignedCandidateCount`/`hitCount` are relation objects. Consumers generated from the documented contract will mis-parse this field.

Evidence (synthesizer): `node dist/cli.js "fff_native_capabilities" --json --source codex --max-results 2` → `assignedCandidateCount: {"value":3,"relation":"eq"}`, `shownLeadCount: 2`, `hitCount: {"value":25,"relation":"eq"}`. Capabilities example: `node dist/cli.js capabilities --json` → `shownLeadCount: {"value":1,"relation":"eq"}`.

Repro (copy-pasteable):

```bash
cd /data/projects/agent-session-search
node dist/cli.js capabilities --json | jq '.examples.defaultCandidateGroups.responseShape.results[0].shownLeadCount'
node dist/cli.js "fff_native_capabilities" --json --source codex --max-results 2 | jq '.results[0].shownLeadCount'
grep -n 'shownLeadCount' docs/mcp.md
```

### Issue 3 — Low: doctor reports multi_grep healthy while live searches demote it with `multi_grep_recall_probe_failed`

Reported by: kimi-k3, claude-fable-5 (deduplicated). Independently re-verified by synthesizer.

`fff-preflight` reports `multi_grep_available: passed` and `recall_equivalence: passed` ("multi_grep recall matched sequential fallback") with `versionGuidance: "current"` for fff-mcp 0.9.6, while every live managed `search_sessions` and CLI search on the same machine returns `metadata.backend: {"mode":"sequential_grep_fallback","fallbackReason":"multi_grep_recall_probe_failed"}` plus per-source `multi_grep_fallback` warnings advising to "Upgrade or configure fff-mcp". Search results remain correct (sequential grep is authoritative and the warnings say so), so the impact is diagnostic trust: doctor gives a false all-green for exactly the condition operators would run it to diagnose, and the warning's suggested action contradicts doctor's "current" guidance.

Evidence (synthesizer, same minute): preflight `checks` include `('multi_grep_available','passed'), ('recall_equivalence','passed')`; CLI search metadata `{"mode":"sequential_grep_fallback","fallbackReason":"multi_grep_recall_probe_failed"}`.

Repro (copy-pasteable):

```bash
cd /data/projects/agent-session-search
node dist/fff-preflight.js --json | jq '.checks[] | select(.id=="multi_grep_available" or .id=="recall_equivalence")'
node dist/cli.js "fff_native_capabilities" --json --source codex --max-results 1 | jq '.metadata.backend'
```

## Overall Rating: 8/10

Rationale: the two-lane architecture is functionally correct and well-enforced — all four evaluators and the objective baseline agree the managed lane stays a one-tool surface, the native lane is exactly the three approved tools, fail-closed source validation fires at the protocol layer before any search (unanimous 9-10 on failClosedCorrectness and boundaryEnforcement), and CLI/MCP output parity holds on the documented contract. The deduction comes from three confirmed defects found between the council and re-verified here: a high-severity packaging bug that makes every documented bin entrypoint non-executable (masked whenever servers are launched via `node`), a medium docs/capabilities-vs-runtime mismatch on `shownLeadCount`, and a low-severity doctor false-green on multi_grep health. None corrupt search results, but Issue 1 blocks the documented acceptance commands outright and should gate the next release.
