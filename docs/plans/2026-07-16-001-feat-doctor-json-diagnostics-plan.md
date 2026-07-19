---
title: "feat: Add agent-native doctor JSON diagnostics"
type: feat
date: 2026-07-16
status: completed
status_notes: "Implemented and shipped in v0.7.0 (ba5f8a5); doctor JSON lane verified by the 2026-07-17 native-lane eval."
verified: code-evidence
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
---

# feat: Add agent-native doctor JSON diagnostics

## Summary

Add a machine-readable `--json` mode to `agent-session-search-doctor` so agents can diagnose FFF setup, source/config health, parse mistakes, and orphaned `fff-mcp` processes without scraping human prose.

The work is intentionally a scoped diagnostic upgrade. It does **not** add a reversible `--fix`/mutate/undo repair system. `--ensure-fff --yes` remains the only doctor action that installs or upgrades FFF MCP; `--reap-orphans` remains the only process cleanup action.

## Product Contract Preservation

This plan preserves the current product contract from `DESIGN.md` and `CONTEXT.md`:

- Keep the public MCP surface centered on the single `search_sessions` tool.
- Keep FFF as the search backend and raw session files as the source of truth.
- Keep `agent-session-search-doctor` as the setup/diagnostic binary for FFF health checks and orphaned `fff-mcp` cleanup.
- Keep parse errors as user-input failures that happen before preflight/search and include suggested commands when a safe correction exists.
- Keep missing or unreadable source roots as warnings, not global failures, when other roots remain usable.

## Problem Frame

The idea-wizard leftovers identify doctor diagnostics as the lowest-risk, highest-value next improvement. Current search and CLI paths are already agent-friendly: `agent-session-search --json`, `sources --json`, `capabilities --json`, `robot-docs guide`, and `--robot-triage` expose stable structures. Doctor still emits only prose.

That leaves agents with brittle behavior:

- They must parse stdout/stderr text to recover per-check details about whether FFF is missing, stale, broken, or smoke-test failing.
- They cannot reliably recover structured guidance, check state, source/config warnings, and orphan cleanup state from one doctor payload.
- They cannot inspect source/config health and backend health in one diagnostic payload.
- They cannot discover doctor JSON behavior from `capabilities` or `robot-docs` because it does not exist yet.

## Scope Boundaries

### In Scope

- `agent-session-search-doctor --json` success payload on stdout.
- `agent-session-search-doctor --json` parse/runtime error payloads on stderr.
- Stable exit semantics for doctor JSON mode: `0`, `1`, `3`, `4`, while preserving existing human-mode behavior.
- Read-only source/config diagnostic block in doctor JSON output.
- Clear handling of `--list-orphans` and `--reap-orphans` in JSON output.
- Capability, robot-docs, CLI docs, MCP docs, and troubleshooting updates that teach the new diagnostic path.
- Focused tests for doctor JSON, error classification, stream separation, and docs/capability alignment.

### Deferred Follow-Up Work

- Full reversible `--fix` system with `mutate()`, backups, undo, action logs, run directories, and concurrency locks.
- Additional lower-level MCP tools for doctor, root resolution, query rewriting, FFF child calls, or excerpt reads.
- Semantic search, vector search, custom indexes, SQLite stores, or markdown session exports.
- Automatic repair of config files or source roots.
- Automatic cleanup of orphaned FFF processes without explicit `--reap-orphans`.
- New source types or changes to built-in source roots unless needed to make source diagnostics truthful.

## Current Evidence

- `src/fff-preflight.ts` owns the doctor parser, `checkFffMcp`, installer path, smoke checks, `multi_grep` recall-equivalence checks, orphan listing/reaping, and entrypoint error handling.
- `src/cli.ts` already implements the desired JSON error-envelope precedent for the main CLI: JSON parse/tool failures go to stderr when `--json` is present, success payloads go to stdout, and exit codes map to `1`, `3`, or `4`.
- `src/help.ts` owns CLI help, capabilities, robot docs, robot triage, and doctor help text.
- `src/roots.ts` and search warnings already define source/root diagnostic warnings such as `missing_root`, `unreadable_root`, `unknown_source`, and `no_sources_selected` with `recommendedAction` guidance.
- `test/fff-preflight.test.ts` covers human doctor output and parse errors, but not doctor JSON.
- `test/cli.test.ts` covers machine-readable capabilities and JSON CLI error envelopes.
- `docs/cli.md`, `docs/mcp.md`, and `docs/troubleshooting.md` document current exit codes, warnings, and doctor usage.

## Key Technical Decisions

### KTD1: `--json` is an output mode, not a new subcommand

`agent-session-search-doctor --json` should run the same default diagnose flow as `agent-session-search-doctor`, then render the result as JSON. This mirrors `agent-session-search --json` and avoids multiplying command shapes.

### KTD2: JSON success goes to stdout; JSON errors go to stderr

Use the existing CLI convention:

- Success: one JSON object on stdout, exit `0`.
- User-input error: one JSON object on stderr, exit `1`.
- Tool-environment error: one JSON object on stderr, exit `3`.
- Upstream/runtime failure: one JSON object on stderr, exit `4`.

Human mode remains unchanged except where tests expose misleading guidance.

### KTD3: Doctor JSON should report checks, not opaque scores

Use explicit check records and stable booleans instead of ranking or scoring:

```ts
type DoctorCheckStatus = "passed" | "failed" | "skipped" | "warning";
```

Each check should include enough data for an agent to act without parsing prose: `id`, `status`, `message`, and optional `recommendedAction`.

### KTD4: Source/config diagnostics are read-only

Doctor JSON may inspect config and source roots, but it must not modify config or directories. Source diagnostics should reuse existing root-resolution logic and warning vocabulary rather than inventing a parallel source-health model.

### KTD5: Preserve existing repair gates

`--ensure-fff` still requires `--yes`. It remains incompatible with `--command <custom-bin>` because the installer targets the default `fff-mcp` on `PATH`. JSON mode must not weaken these parse-time gates.

### KTD6: Make orphan behavior explicit and fail-safe

If both `--list-orphans` and `--reap-orphans` are passed, reject the combination as `user_input_error`. Listing is read-only; reaping is a process mutation. Keeping the flags mutually exclusive avoids an accidental cleanup from a composed diagnostic command. The JSON payload should include `orphans.mode: "list"` with `found` for list mode, and `orphans.mode: "reap"` with `found`, `reaped`, and `failed` for reap mode.

## Doctor JSON Contract v1

All `--json` results use `contractVersion: "1.0"` and a single top-level envelope. Consumers must ignore unknown fields, but implementation must not remove or change the required fields below within contract version `1.0`.

### Success envelope

Required fields:

- `tool: "agent-session-search-doctor"`
- `contractVersion: "1.0"`
- `ok: true`
- `command`
- `requiredRelease`
- `recommendedRelease`
- `installCommand`
- `checks`
- `sourceDiagnostics`
- `orphans`

Optional fields:

- `resolvedPath`
- `version`

### Error envelope

Required fields:

- `tool: "agent-session-search-doctor"`
- `contractVersion: "1.0"`
- `ok: false`
- `error`
- `checks`
- `sourceDiagnostics`
- `orphans`
- `exitCode`

Required `error` fields:

- `code`
- `message`

Optional `error` fields:

- `hint`
- `suggestedCommand`
- `canEnsureFff`
- `recommendedAction`

Allowed `error.code` values:

- `user_input_error` for parse errors and invalid user-controlled config JSON.
- `tool_environment_error` for missing/stale/incompatible FFF MCP and unreadable environment/config paths.
- `upstream_failure` for unclassified runtime failures and upstream process failures.

### Diagnostic sections

- `checks` is an array of `{ id, status, message, recommendedAction? }`.
- `status` values are `passed`, `failed`, `skipped`, and `warning`.
- `sourceDiagnostics` is either `null` or `{ configPath, sources, warnings }`.
- `sourceDiagnostics.sources[]` uses the existing source inspection fields: `name`, `root`, `enabled`, `include`, `status`, and optional `warning`.
- `sourceDiagnostics.warnings[]` uses the existing warning envelope fields: `source?`, `root?`, `code`, `message`, and `recommendedAction?`.
- `orphans` is either `null` or `{ mode, status, found, reaped?, failed?, reason? }`.
- `orphans.mode` is `list` or `reap`.
- `orphans.status` uses `passed`, `failed`, `skipped`, or `warning`.

### Runtime ordering and partial diagnostics

After parse succeeds, `doctor --json` should collect read-only source diagnostics before or independently of the FFF check, then include `sourceDiagnostics` in both success stdout envelopes and FFF tool-environment error stderr envelopes when config can be read.

Invalid user-controlled config JSON returns `user_input_error` before FFF checks and does not run later diagnostics. Config permission/read failures return `tool_environment_error` before FFF checks and do not run later diagnostics. Missing config files keep the existing default-empty-config behavior.

Fatal FFF failures set `ok: false`, `error.code: "tool_environment_error"`, and `exitCode: 3`, but preserve completed `sourceDiagnostics` and mark unrun check/orphan phases as `skipped` with a reason when relevant.

Requested orphan listing/reaping is explicit and may run independently of FFF health and source/config validation in JSON mode after flag parsing succeeds. If orphan discovery itself fails, the envelope must include `orphans.status: "failed"`; the top-level `error.code` and `exitCode` follow the strongest current error class rather than being inferred from orphan status alone.

## Implementation Units

### U1. Add doctor JSON option and shared result envelope

**Goal:** Teach `src/fff-preflight.ts` to parse `--json` and render stable JSON without changing default human output.

**Files:**

- `src/fff-preflight.ts`
- `test/fff-preflight.test.ts`

**Requirements:**

- Add `json: boolean` to the parsed doctor options.
- Treat `--json` as a deduped boolean option, consistent with existing parser style.
- Keep help/version-style short-circuits unchanged unless `--json help` is explicitly supported by implementation; do not invent a separate help schema in this unit.
- Build a success payload shaped for agents, not human prose.
- Ensure JSON success writes exactly one parseable JSON object to stdout and no human prose to stderr.

**Recommended success shape:**

```json
{
  "tool": "agent-session-search-doctor",
  "contractVersion": "1.0",
  "ok": true,
  "command": "fff-mcp",
  "resolvedPath": "/abs/path/to/fff-mcp",
  "version": "9.9.9-test",
  "requiredRelease": "v0.9.6",
  "recommendedRelease": "v0.9.6",
  "installCommand": "curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash",
  "checks": [],
  "sourceDiagnostics": null,
  "orphans": null
}
```

The exact implementation may use richer nested fields if tests pin the contract. Avoid free-form-only fields.

**Test Scenarios:**

- Covers `agent-session-search-doctor --json --skip-smoke` with fake `fff-mcp` prints parseable stdout and no stderr.
- Covers payload includes command, version, `requiredRelease`, `recommendedRelease`, install command, and `checks` as an array.
- Covers human `agent-session-search-doctor --skip-smoke` output remains compatible with existing assertions.

### U2. Add JSON error envelopes and exit classification

**Goal:** Make doctor failures as machine-readable as CLI failures.

**Files:**

- `src/fff-preflight.ts`
- `test/fff-preflight.test.ts`

**Requirements:**

- Parse failures under `--json` write a JSON envelope to stderr and exit `1`.
- Missing, stale, or incompatible `fff-mcp` under `--json` writes a JSON envelope to stderr and exits `3`.
- Upstream/runtime failures under `--json` write a JSON envelope to stderr with `error.code: "upstream_failure"` and exit `4`.
- Include `suggestedCommand` when the parser already knows one.
- Include `hint` when the parser already knows one.
- Include `canEnsureFff` and install guidance for FFF dependency failures.
- Do not print human usage in JSON mode.
- Include completed `sourceDiagnostics` in FFF tool-environment error envelopes when config can be read.
- Include `exitCode` in every JSON error envelope.

**Recommended error shape:**

```json
{
  "tool": "agent-session-search-doctor",
  "contractVersion": "1.0",
  "ok": false,
  "error": {
    "code": "user_input_error",
    "message": "Unknown option: --wat",
    "hint": "Run help to inspect supported doctor flags.",
    "suggestedCommand": "agent-session-search-doctor help"
  },
  "checks": [],
  "sourceDiagnostics": null,
  "orphans": null,
  "exitCode": 1
}
```

Allowed `error.code` values:

- `user_input_error`
- `tool_environment_error`
- `upstream_failure`

**Test Scenarios:**

- Covers `--json --wat` returns stderr JSON with `error.code: "user_input_error"`, suggested command, no stdout, exit `1`.
- Covers `--json --command` missing value returns suggested `agent-session-search-doctor --command <bin>`.
- Covers `--json --ensure-fff` without `--yes` returns suggested `agent-session-search-doctor --ensure-fff --yes`.
- Covers missing `fff-mcp` returns `error.code: "tool_environment_error"`, includes installer command, no stdout, exit `3`.
- Covers upstream/runtime thrown error path if current tests can inject one without brittle internals.

### U3. Normalize FFF diagnostic checks

**Goal:** Represent version, smoke, `multi_grep`, recall equivalence, and ensure guidance as structured checks.

**Files:**

- `src/fff-preflight.ts`
- `src/fff-runtime.ts` only if helper types or failure classification naturally belong there
- `test/fff-preflight.test.ts`

**Requirements:**

- Convert the existing `checkFffMcp` result into reusable data before presentation.
- Preserve current human presentation by rendering from the same data object where practical.
- Include check ids that are stable enough for agents and tests:
  - `command_found`
  - `version_minimum`
  - `smoke_grep`
  - `multi_grep_available`
  - `recall_equivalence`
- If `multi_grep` is unavailable but sequential fallback remains healthy, report a `warning` check rather than failing the whole doctor command.
- If `--skip-smoke` is passed, mark smoke and recall-equivalence checks as `skipped` rather than omitting them.
- If smoke fails, make `canEnsureFff: false` visible in JSON when installer repair is not expected to solve the problem.
- Keep `REQUIRED_FFF_MCP_RELEASE`, `RECOMMENDED_FFF_MCP_RELEASE`, and `FFF_MCP_INSTALL_COMMAND` as the source of truth for release guidance.

**Test Scenarios:**

- Covers skipped smoke check status when `--skip-smoke` is present.
- Covers available `multi_grep` and recall-equivalence success with a fake FFF script if existing test helpers already support it.
- Covers missing `multi_grep` reports a warning while sequential fallback remains healthy.
- Covers smoke failure payload and recommendation do not overclaim that reinstalling will fix a non-install smoke failure.

### U4. Include read-only source/config diagnostics in doctor JSON

**Goal:** Let agents answer “is search broken because FFF is broken, config is malformed, or roots are missing?” from one doctor JSON call.

**Files:**

- `src/fff-preflight.ts`
- `src/roots.ts` and `src/env.ts` only if exported helpers need minor adjustment
- `test/fff-preflight.test.ts`
- `test/root-resolver.test.ts` only if root-inspection contracts move

**Requirements:**

- Reuse existing source inspection/root resolution behavior; do not duplicate warning vocabulary.
- Include config path and source summaries in `--json` output.
- Preserve canonical absolute roots where available.
- Include warnings with existing fields: `source?`, `root?`, `code`, `message`, `recommendedAction?`.
- Source/config diagnostics must be read-only. They must not create roots, edit config, or disable sources.
- Missing roots should not make doctor fail if FFF checks pass; they are warnings in the `sourceDiagnostics` block.
- Malformed config is classified as `user_input_error` if the configured file exists but is invalid user-controlled JSON; config permission/read failures are classified as `tool_environment_error`.
- If `AGENT_SESSION_SEARCH_CONFIG` is present, doctor JSON should resolve `configPath` through the same environment parsing path as search (`searchOptionsFromEnv(env).configPath`) before inspecting sources.

**Recommended source shape:**

```json
{
  "configPath": "/home/user/.config/agent-session-search/config.json",
  "sources": [
    {
      "name": "codex",
      "root": "/home/user/.codex",
      "enabled": true,
      "status": "ok",
      "include": ["sessions/*.jsonl"]
    }
  ],
  "warnings": []
}
```

This object lives under top-level `sourceDiagnostics`, not top-level `sources`, to avoid ambiguous `sources.sources` payloads.

**Test Scenarios:**

- Covers `AGENT_SESSION_SEARCH_CONFIG` with a missing configured source root produces `sourceDiagnostics.warnings` in doctor JSON and exit `0` when FFF passes.
- Covers malformed config returns a structured JSON `user_input_error` and does not run later checks because diagnostics cannot safely continue.
- Covers warning `recommendedAction` points to `agent-session-search sources --json` or equivalent existing recovery guidance.
- Covers missing `fff-mcp` plus readable source diagnostics preserves `sourceDiagnostics` in the stderr error envelope.

### U5. Structure orphan diagnostics for JSON mode

**Goal:** Make `--list-orphans` and `--reap-orphans` agent-readable while preserving explicit cleanup.

**Files:**

- `src/fff-preflight.ts`
- `test/fff-preflight.test.ts`

**Requirements:**

- Include `orphans` only when `--list-orphans` or `--reap-orphans` is requested, or include `null` when absent.
- For listing, include `mode: "list"`, `found`, and no mutation fields.
- For reaping, include `mode: "reap"`, `found`, `reaped`, and `failed`.
- If both flags are passed, reject the combination as `user_input_error`; this is the fail-safe path because `--reap-orphans` mutates processes.
- Reaping remains an explicit mutation and never runs merely because `--json` is present.
- If FFF validation fails and an orphan flag was requested, run the explicit orphan operation independently and attach its result to the stderr error envelope after flag parsing succeeds.
- Partial reap failures produce `orphans.status: "failed"`; the top-level exit code and `error.code` follow the strongest current error class (`user_input_error` before `tool_environment_error` before `upstream_failure`).

**Test Scenarios:**

- Covers `--json --list-orphans` with `AGENT_SESSION_SEARCH_DOCTOR_PS_FIXTURE` returns found orphans in `orphans.found`.
- Covers `--json --reap-orphans` returns `orphans.reaped` and failed attempts.
- Covers combined flags are rejected as `user_input_error`.
- Covers `--json --list-orphans` when FFF is missing attaches `orphans` to the FFF error envelope.
- Covers partial reap failure status and top-level precedence when no stronger error exists.

### U6. Update discovery surfaces and docs

**Goal:** Ensure agents discover the new doctor JSON contract from the same places they already inspect.

**Files:**

- `src/help.ts`
- `docs/cli.md`
- `docs/mcp.md`
- `docs/troubleshooting.md`
- `README.md` only if the existing setup section mentions doctor commands enough to avoid doc drift
- `test/cli.test.ts`
- `test/fff-preflight.test.ts`

**Requirements:**

- Add `--json` to `doctorHelpText()` usage/options/examples.
- Update `cliCapabilities()` with a doctor command entry or augment the existing command list so `agent-session-search capabilities --json` advertises doctor JSON semantics.
- Update `robotDocsGuide()` and `robotTriage()` to recommend `agent-session-search-doctor --json` for agent-driven setup diagnostics.
- Update docs to state stream rules, exit codes, and sample payloads.
- Keep examples short; do not document the deferred `--fix` system as if it exists.

**Test Scenarios:**

- Covers capabilities JSON includes a doctor command or health-check entry with `--json`.
- Covers robot docs/triage mention `agent-session-search-doctor --json`.
- Covers doctor help includes `--json`.
- Existing docs exposure test in `test/fff-preflight.test.ts` remains green after doc changes.

## Verification Contract

Implementation is complete when all of the following are true:

1. `npm run check` succeeds.
2. `npm test -- test/fff-preflight.test.ts` succeeds.
3. `npm test -- test/cli.test.ts` succeeds if `src/help.ts` or capabilities/robot docs changed.
4. Manual smoke command with fake or installed FFF proves JSON mode is parseable:
   - `agent-session-search-doctor --json --skip-smoke`
5. Manual smoke command proves JSON parse failure uses stderr and exit `1`:
   - `agent-session-search-doctor --json --wat`
6. A temporary config with one missing root produces `sourceDiagnostics.warnings` while returning exit `0` when FFF itself passes.
7. Missing `fff-mcp` plus a missing configured source root returns stderr JSON with both `error.code: "tool_environment_error"` and `sourceDiagnostics.warnings`.
8. `--json --list-orphans` with missing FFF attaches orphan results or an explicit orphan skip/failure reason to the stderr error envelope.
9. Existing human doctor smoke still works:
   - `agent-session-search-doctor --skip-smoke`

## Risks And Mitigations

| Risk                                                             | Mitigation                                                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| JSON schema drift makes agents brittle                           | Pin contract fields in `test/fff-preflight.test.ts` and advertise `contractVersion`.               |
| Human output accidentally changes                                | Keep existing tests and render human prose from the same result object only after JSON tests pass. |
| Source diagnostics duplicate root resolver behavior              | Reuse `inspectSessionSources`/`resolveSessionRoots` behavior and existing warning fields.          |
| Installer guidance overclaims smoke failures are install-fixable | Include `canEnsureFff` and tailor `recommendedAction` by failure type.                             |
| `--json` accidentally enables mutation                           | Keep `--ensure-fff --yes` and `--reap-orphans` as the only explicit mutating actions.              |
| Malformed config classification is inconsistent                  | Add targeted tests for invalid config JSON and unreadable/missing config behavior.                 |

## Open Questions

1. Should human doctor output gain source/config summaries too? Default: no in this slice; add source/config diagnostics only to JSON unless a user-facing doc need appears during implementation.

## Sequencing

1. U1 and U2 first: establish JSON transport, error contract, and the required envelope shape.
2. U3 next: normalize existing FFF checks into stable check data.
3. U5 next: add orphan JSON sections and explicit failure-ordering behavior while still localized to doctor code.
4. U4 next: add mandatory read-only source/config diagnostics using existing root-inspection behavior.
5. U6 last: update help, capabilities, robot docs, public docs, and any optional shell regression scripts after focused tests pass.

## Handoff Notes

- Start from `src/fff-preflight.ts`; do not add another doctor entrypoint.
- Treat `src/cli.ts` as the precedent for JSON error envelope style, not as a module to couple doctor to directly unless a tiny shared helper naturally emerges.
- Avoid broad refactors. The desired change is diagnostic output shape, not a full CLI framework rewrite.
- Keep all file paths repo-relative in docs and tests.
