# Uplift Diff

This was the first pass, so there is no prior scorecard artifact to diff against.

Measured uplift was computed from pre-pass runtime/source findings versus post-pass tests and dist smoke checks:

- Discovery/self-documentation: +490 on CLI discovery surfaces.
- Agent ergonomics: +450 on planned probe/context support.
- Output parseability: +490 on JSON help/error behavior.
- Error pedagogy: +320 on unknown-source recovery and JSON parse errors.
- Regression resistance: +300 through focused Vitest coverage and audit regression scripts.

## Pass 2

Deferred-item uplift:

- MCP version alignment: server info now reports the package version from `package.json` instead of stale `0.1.0`.
- MCP structured-output clarity: FastMCP 4.0.1 behavior is verified and pinned; `search_sessions` intentionally returns JSON text content and does not advertise `outputSchema` until the wrapper can return successful `structuredContent`.
- Source/config inspection: added a CLI-only `sources --json` command with config path, source status, enabled state, include globs, and warnings. The MCP surface remains the single `search_sessions` tool.
