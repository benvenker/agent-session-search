# Pass 1 Playbook

Applied recommendations:

1. Add machine-readable discovery: `capabilities --json`, `robot-docs guide`, and `--robot-triage`.
2. Add CLI parity for planned probes and operational context: `--probe`/`--query`, `--cwd`, `--branch`, `--reason`.
3. Make JSON-first help and parse failures machine-readable.
4. Close FFF resources after each CLI invocation so CLI searches exit cleanly.
5. Make `agent-session-search-doctor --help` a normal first-try command.
6. Make unknown-source warnings name enabled sources and the recovery path.

Deferred:

- MCP output still returns a JSON string through FastMCP. It is compatible with the current smoke tests, but a future pass should verify whether FastMCP can return structured content directly.
- The MCP server version still deserves a package-version alignment check.
