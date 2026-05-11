# Regression Alerts

No regressions observed in validation.

Residual risks:

- `agent_ergonomics_audit` helper scripts from the upstream skill assume GNU `flock` and `timeout`; this pass used repo-native validation on macOS.
- Native MCP `structuredContent` remains a future FastMCP-wrapper upgrade path. Pass 2 pinned the current behavior: `search_sessions` returns JSON text content and does not advertise `outputSchema`.
