# Agent Session Search

Local MCP server for searching coding-agent session history.

## Development

```bash
npm install
npm run check:fff
npm run check
npm test
npm run build
```

`npm install` installs this package's Node dependencies. It does not install the
external `fff-mcp` binary used by the search backend.

Verify that FFF MCP is available before running the server:

```bash
npm run check:fff
```

When using an installed build of this package, run:

```bash
agent-session-search-doctor
```

If `fff-mcp` is missing, install it with the official FFF MCP installer:

```bash
curl -L https://dmtrkovalenko.dev/install-fff-mcp.sh | bash
```

Review the installer before running it if desired:

```text
https://dmtrkovalenko.dev/install-fff-mcp.sh
```

## MCP Server

Run the server over stdio:

```bash
npm run dev:mcp
```

After building, the MCP entrypoint is:

```bash
node dist/server.js
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

## Configuration

- `AGENT_SESSION_SEARCH_CONFIG`: path to the JSON source-root configuration file.
- `AGENT_SESSION_SEARCH_FFF_DB_DIR`: directory containing `frecency.mdb` and
  `history.mdb` for FFF MCP.
- `AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_ATTEMPTS`: retry count for empty FFF
  results.
- `AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_DELAY_MS`: delay between empty-result
  retries in milliseconds.
