# Troubleshooting

## `fff-mcp` Not Found

Symptom:

```text
fff-mcp was not found on PATH
```

Cause: Agent Session Search delegates real search work to the external `fff-mcp` binary.

Fix:

```bash
curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash
agent-session-search-doctor --json
```

Review the installer first if needed: <https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh>. The required and documented stable FFF MCP release for this package is `v0.9.6`.

To let doctor run the official installer explicitly:

```bash
agent-session-search-doctor --ensure-fff --yes
```

## `fff-mcp` Is Too Old

Symptom:

```text
fff-mcp 0.9.5 is below required minimum v0.9.6
```

Cause: the installed external `fff-mcp` binary is older than the runtime version Agent Session Search expects.

Fix:

```bash
agent-session-search-doctor --ensure-fff --yes
agent-session-search-doctor --json
```

## FFF `multi_grep` Falls Back

Symptom:

```text
multi_grep_fallback
```

Cause: `multi_grep` is absent, failed, or did not match the sequential `grep` union during the recall-equivalence probe.

Fix: no action is required for correctness. Agent Session Search uses sequential `grep` as the authoritative fallback and reports the fallback reason in `metadata.backend`. Run doctor JSON to inspect installed version, `multi_grep` support, and recall-equivalence status:

```bash
agent-session-search-doctor --json
```

Upgrade FFF only when you want the faster backend path:

```bash
curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash
```

## Malformed Group Follow-Up

Symptom:

```text
invalid_group_followup
```

Cause: a `groupCandidates` payload was edited, invented, or no longer matches the top-level query, mode, paths, resolved sources, or query plan.

Fix: copy `more.groupCandidates` exactly from a candidate group returned by `search_sessions`, either under the `groupCandidates` field or as the exact top-level shorthand. In the CLI, save the payload JSON and run `agent-session-search --json --group-candidates @payload.json`. Do not mix in edited fields. For line evidence, copy a candidate's `more.evidence` payload instead.

## Missing Or Unreadable Roots

Symptoms include warning codes:

- `missing_root`
- `unreadable_root`

Cause: a built-in or configured source root does not exist on this machine, or the current user cannot read it.

Inspect:

```bash
agent-session-search sources --json
```

Fix the path, create the directory, adjust permissions, or disable that source in `~/.config/agent-session-search/config.json`:

```json
{
  "roots": [
    {
      "name": "pi",
      "path": "/Users/ben/.pi/agent/sessions",
      "enabled": false
    }
  ]
}
```

Missing roots are normal on machines that do not use every supported agent. Other readable roots still search.

## Unknown Source

Symptom:

```text
unknown_source
```

Cause: `--source` or MCP `sources` requested a source that is not configured or is disabled.

Fix:

```bash
agent-session-search sources --json
```

Use one of the enabled names, omit `--source`, or add the source to config.

## Broad Evidence Is Capped

Symptom:

```text
broad_evidence_capped
```

Cause: unscoped evidence mode is intentionally bounded.

Fix: start with candidates, then request focused evidence for one candidate path:

```bash
agent-session-search "auth token timeout" --json
agent-session-search "auth token timeout" --json --evidence --path /absolute/session.jsonl
```

## Current Codex Session Ranks Too High

Cause: the active session contains the search text and looks relevant.

Fix: pass a reliable live caller identity with the request:

```json
{
  "query": "auth token timeout",
  "callerSession": {
    "source": "codex",
    "sessionId": "019edba3-fc85-74f1-b391-ef17d86f9985"
  }
}
```

When `callerSession.source` and `callerSession.sessionId` exactly match a candidate, that current session is demoted for any source. For Codex-only compatibility, `CODEX_THREAD_ID` still works when it is available to the process running Agent Session Search, but long-lived MCP servers may not inherit the active Codex thread id.

## Old `fff-mcp` Children Linger

Cause: a previous MCP client or CLI process crashed after spawning FFF children.

Inspect first:

```bash
agent-session-search-doctor --json --list-orphans
```

Clean up:

```bash
agent-session-search-doctor --json --reap-orphans
```

`--reap-orphans` kills matching orphaned `fff-mcp` processes with `SIGKILL` and does not prompt. In JSON mode, listing returns `orphans.mode: "list"` with `found`; reaping returns `orphans.mode: "reap"` with `found`, `reaped`, and `failed`.

## Mistyped Flags

CLI and doctor parse failures happen before search or preflight. Near-miss flags include a suggested command when the tool can infer a safe correction.

Example:

```bash
agent-session-search --jason "auth token timeout"
```

Human output includes usage and a suggested command. With `--json`, the error is written to stderr as a JSON envelope with `error.code: "user_input_error"`.

Doctor JSON follows the same stream rules:

```bash
agent-session-search-doctor --json --wat
```

The command exits `1`, leaves stdout empty, and writes a concise stderr object:

```json
{
  "tool": "agent-session-search-doctor",
  "contractVersion": "1.0",
  "ok": false,
  "error": {
    "code": "user_input_error",
    "message": "Unknown option: --wat",
    "suggestedCommand": "agent-session-search-doctor help"
  },
  "checks": [],
  "sourceDiagnostics": null,
  "orphans": null,
  "exitCode": 1
}
```

Successful doctor JSON exits `0` and writes stdout only. Missing or stale `fff-mcp` exits `3` with `error.code: "tool_environment_error"` on stderr; unexpected upstream failures exit `4` with `error.code: "upstream_failure"` on stderr.

## All Attempted Sources Failed

Symptom:

```text
all_sources_failed
```

Cause: every source that could be attempted failed and no results were found.

Fix: read the warning message. It includes a concrete `rg` fallback command for exhaustive proof-style search.
