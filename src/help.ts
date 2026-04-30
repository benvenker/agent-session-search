export function cliHelpText() {
  return [
    "Usage: agent-session-search <query> [--json] [--source <source>...] [--mode <candidates|evidence|debug>] [--path <path>...]",
    "       agent-session-search help",
    "",
    "Search local coding-agent session history through the same engine as the MCP server.",
    "",
    "Commands:",
    "  help                       Show this help.",
    "",
    "Options:",
    "  --json                     Print the full search result as JSON.",
    "  --source <source>          Restrict search to a source. Repeat for multiple sources.",
    "  --mode <candidates|evidence|debug>",
    "                             Select result detail. Defaults to candidates.",
    "  --candidates               Return compact session-level leads.",
    "  --evidence                 Return matching snippets, usually with --path.",
    "  --debug                    Return query expansion and backend diagnostics.",
    "  --path <path>              Restrict evidence to a canonical session path. Repeatable.",
    "  -h, --help                 Show this help.",
    "",
    "Examples:",
    '  agent-session-search "auth token timeout" --json',
    '  agent-session-search "global search" --source codex --source claude',
    '  agent-session-search "auth token timeout" --json --evidence --path /Users/ben/.codex/sessions/session.jsonl',
    "",
    "MCP:",
    "  Run agent-session-search-mcp to expose the search_sessions tool over stdio.",
    "  Use query for a concise recall task, queries for short literal probes, and operationalContext for cwd, branch, and why you are searching.",
    "",
    "Setup:",
    "  Run agent-session-search-doctor to verify the FFF backend.",
    "  Set AGENT_SESSION_SEARCH_CONFIG to use a custom config file.",
  ].join("\n");
}

export function mcpSearchSessionsDescription() {
  return [
    "Search local coding-agent session history across configured sources.",
    "This is an agentic recall tool: when the user request is conversational or underspecified, infer the operational context from your environment and pass several short literal probes in `queries`.",
    "Set `query` to a concise recall task, not the full prompt or response-format instructions. Strip tool-use directions, output-format requests, and examples from `query`.",
    "Use `operationalContext` for useful context such as cwd, repo/project, branch, recent chat, why the user is searching, and any relevant prompt details that should not become search text.",
    "If `queries` is omitted, the tool falls back to deterministic rewriting of `query`.",
    "The default `resultsDisplayMode` is `candidates`: compact session-level leads grouped by source/path. Use a candidate `more.evidence` object as the next tool input when you need matching snippets from a selected session. Use `debug` only when inspecting query expansion or backend behavior.",
  ].join(" ");
}
