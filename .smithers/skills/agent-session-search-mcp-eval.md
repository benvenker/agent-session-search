---
name: agent-session-search-mcp-eval
description: Evaluate Agent Session Search managed/native MCP lanes and CLI with live probes.
---

# Agent Session Search MCP Eval

Use this skill when evaluating this repository's managed MCP server, native FFF MCP server, and CLI.

Required checks:

- Build the repo before evaluating runtime behavior.
- Treat `dist/server.js` as the managed MCP server and `dist/native-server.js` as the native FFF MCP server.
- Use live MCP calls, not mocked tool lists.
- Managed lane checks: `tools/list` and `search_sessions`.
- Native lane checks: `tools/list`, `fff_native_capabilities`, `fff_grep` with a valid source discovered from capabilities, `fff_grep` with source omitted, and `fff_grep` with a bogus source.
- CLI checks: `agent-session-search capabilities --json`, `agent-session-search-doctor --json`, and one real search.
- Omitted or bogus native source access should fail closed. Report exact observed errors.
- Rate `managedParity`, `failClosedCorrectness`, `boundaryEnforcement`, `docsAccuracy`, and `acceptanceExamples` from 1 to 10.
- Confirm issues with concrete evidence and a copy-pasteable repro command or exact MCP tool call.
