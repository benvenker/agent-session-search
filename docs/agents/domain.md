# Domain Docs

This is a single-context repo.

Engineering skills should read these files when they exist:

- `CONTEXT.md` at the repo root for quick project orientation and vocabulary
- `DESIGN.md` as the current design record for this project
- `docs/adr/` for architecture decisions

If `docs/adr/` does not exist, proceed silently. Do not create ADRs just to satisfy this setup; create them only when recording an architecture decision.

## Ubiquitous Language

Use this repo's existing terms consistently:

- `search_sessions`
- MCP server
- MCP tool
- MCP tool result
- tool result `content`
- `structuredContent`
- `outputSchema`
- FFF
- `fff-mcp`
- source roots
- root resolution
- query rewriting
- fanout
- path normalization
- response shaping
- candidates
- evidence groups
- evidence hits
- warnings

Prefer these terms from `DESIGN.md` when writing plans or Beads. Do not rename candidates to "sessions", "documents", or "memories" unless the text is deliberately contrasting them.

## External Terms

When a term has an industry-standard or protocol-standard meaning, validate it against primary sources before adding local terminology. Prefer canonical terms over private synonyms.

For MCP-related work, check the official Model Context Protocol documentation before naming concepts. MCP follows a host/client/server architecture, uses JSON-RPC messages, and defines server primitives for tools, resources, and prompts. Tools are executable functions exposed by servers and invoked through `tools/call`; tool results can include a `content` array and, when supported, `structuredContent`. Use those terms unless this repo has a deliberate reason to define a narrower local term.

Useful primary references:

- https://modelcontextprotocol.io/docs/learn/architecture
- https://modelcontextprotocol.io/specification/2025-06-18/server
- https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- https://modelcontextprotocol.io/specification/2025-06-18/basic/index

## ADR Conflicts

If proposed work contradicts an existing ADR, surface the conflict before proceeding.
