# Regression Alerts

No regressions observed in validation.

Residual risks:

- `agent_ergonomics_audit` helper scripts from the upstream skill assume GNU `flock` and `timeout`; this pass used repo-native validation on macOS.
- Structured MCP output should be investigated separately because the current FastMCP path returns JSON as text.
