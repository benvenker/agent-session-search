# Regression Alerts - Pass 5

No regressions greater than 50 points were found.

Notes:

- The first parallel audit-regression attempt failed because it ran concurrently with other project checks that touched build output. Re-running after `npm run build` and serializing `agent_ergonomics_audit/audit/regression_tests/*.test.sh` passed.
- FFF MCP is now installed at `0.9.5`, and `npm run check:fff` verifies live grep, `multi_grep`, and recall equivalence.
