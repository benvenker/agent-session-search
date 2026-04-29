# Agent Session Search

Local MCP server for searching coding-agent session history.

## Development

```bash
npm install
npm run check
npm test
npm run build
```

## MCP Server

Run the server over stdio:

```bash
npm run dev:mcp
```

After building, the MCP entrypoint is:

```bash
node dist/src/server.js
```

The server exposes one tool:

```text
search_sessions
```

V1 currently scaffolds the MCP/tool boundary and shared library seam. The search
backend is implemented by the follow-up beads.

## CLI Smoke Path

Run the automated smoke path through the real stdio MCP entrypoint with a
deterministic fixture root:

```bash
npm run smoke
```

For manual local checks against your configured session roots, run the shared
library through the local CLI:

```bash
npm run dev:cli -- "auth token timeout" --json
```

The JSON output includes the original `query`, `expandedPatterns`,
`searchedSources`, `warnings`, and `results`.
