export function cliHelpText() {
  return [
    "Usage: agent-session-search <query> [--json] [--source <source>...] [--mode <candidates|evidence|debug>] [--path <path>...] [--max-results <n>]",
    "       agent-session-search help",
    "       agent-session-search --version",
    "       agent-session-search sources --json",
    "       agent-session-search capabilities --json",
    "       agent-session-search robot-docs guide",
    "       agent-session-search --robot-triage",
    "",
    "Search local coding-agent session history through the same engine as the MCP server.",
    "",
    "Commands:",
    "  help                       Show this help.",
    "  version                    Print the package version.",
    "  sources --json             Inspect configured source roots without running a search.",
    "  capabilities --json        Print the agent-readable CLI and MCP contract.",
    "  robot-docs guide           Print the in-tool guide for coding agents.",
    "",
    "Options:",
    "  --json                     Print the full search result as JSON.",
    "  --robot-triage             Print quick reference, commands, and health checks as JSON.",
    "  --source <source>          Restrict search to a source. Repeat for multiple sources.",
    "  --probe <query>            Add an agent-planned literal probe. Repeat for multiple probes.",
    "  --cwd <path>               Add cwd to operationalContext.",
    "  --branch <name>            Add branch to operationalContext.",
    "  --reason <text>            Add search reason to operationalContext.",
    "  --mode <candidates|evidence|debug>",
    "                             Select result detail. Defaults to candidates.",
    "  --candidates               Return compact session-level leads.",
    "  --evidence                 Return matching snippets, usually with --path.",
    "  --debug                    Return query expansion and backend diagnostics.",
    "  --path <path>              Restrict evidence to a canonical session path. Repeatable.",
    "  --max-patterns <n>         Limit expanded literal search patterns.",
    "  --max-results <n>          Limit results per source, including focused --path evidence. Alias: --max-results-per-source.",
    "  -h, --help                 Show this help.",
    "  -v, --version              Print the package version.",
    "",
    "Examples:",
    '  agent-session-search "auth token timeout" --json',
    "  agent-session-search capabilities --json",
    "  agent-session-search sources --json",
    "  agent-session-search robot-docs guide",
    "  agent-session-search --robot-triage",
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

export function cliCapabilities(version: string) {
  return {
    tool: "agent-session-search",
    version,
    contractVersion: "1.0",
    purpose:
      "Search local coding-agent session history across configured text transcript roots.",
    mcp: {
      tools: [{ name: "search_sessions" }],
      policy:
        "Keep the public MCP surface centered on this single tool; use result modes and follow-up payloads instead of adding extra MCP tools.",
    },
    commands: [
      {
        name: "search",
        usage:
          'agent-session-search "<query>" [--json] [--probe <query>...] [--cwd <path>] [--branch <name>] [--reason <text>] [--source <source>...] [--mode <candidates|evidence|debug>] [--path <path>...]',
        output:
          "--json prints the same result envelope as the MCP search_sessions tool.",
      },
      {
        name: "sources",
        usage: "agent-session-search sources --json",
        output:
          "Machine-readable source-root inspection with enabled, status, include, and warning fields.",
      },
      {
        name: "capabilities",
        usage: "agent-session-search capabilities --json",
        output:
          "Machine-readable contract with commands, modes, env vars, and exit codes.",
      },
      {
        name: "robot-docs guide",
        usage: "agent-session-search robot-docs guide",
        output: "Paste-ready guide for coding agents.",
      },
      {
        name: "--robot-triage",
        usage: "agent-session-search --robot-triage",
        output:
          "JSON quick reference with recommended commands and health checks.",
      },
      {
        name: "doctor",
        usage: "agent-session-search-doctor [--skip-smoke] [--list-orphans]",
        output: "FFF backend setup diagnostics.",
      },
    ],
    resultModes: [
      {
        name: "candidates",
        shape: "candidates",
        use: "Default compact session-level leads with more.evidence follow-ups.",
      },
      {
        name: "evidence",
        shape: "evidence_groups or evidence_hits",
        use: "Matching snippets; pass paths for focused raw evidence hits.",
      },
      {
        name: "debug",
        shape: "evidence_hits",
        use: "Inspect query expansion and backend behavior.",
      },
    ],
    env: [
      {
        name: "AGENT_SESSION_SEARCH_CONFIG",
        use: "Override the JSON source-root config path.",
      },
      {
        name: "AGENT_SESSION_SEARCH_FFF_DB_DIR",
        use: "Override where temporary FFF frecency/history databases are written.",
      },
    ],
    exitCodes: [
      { code: 0, meaning: "success" },
      { code: 1, meaning: "user-input-error" },
    ],
  };
}

export function robotDocsGuide() {
  return [
    "Agent guide: agent-session-search",
    "",
    "Primary path:",
    '  agent-session-search "auth token timeout" --json',
    '  agent-session-search "Find PR 227 work" --json --probe "PR #227" --probe paper-cuts --cwd /repo --branch paper-cuts --reason "Recover prior context"',
    "",
    "Use `query` for the concise recall task. If you already know useful literal probes, call the MCP `search_sessions` tool with `queries` and `operationalContext` rather than stuffing instructions into `query`.",
    "",
    "Default result mode is `candidates`. Pick a candidate, then echo its `more.evidence` payload to `search_sessions` or use the matching CLI form:",
    '  agent-session-search "<query>" --json --evidence --path /absolute/session/path.jsonl',
    "",
    "Discovery:",
    "  agent-session-search capabilities --json",
    "  agent-session-search --robot-triage",
    "  agent-session-search-doctor",
    "",
    "Contract notes:",
    "- FFF is the search engine.",
    "- Results preserve canonical absolute paths plus source and root metadata.",
    "- Missing roots are warnings; partial success is expected.",
    "- Keep the MCP surface centered on `search_sessions`.",
  ].join("\n");
}

export function robotTriage(version: string) {
  return {
    tool: "agent-session-search",
    version,
    quickRef: {
      mcpTool: "search_sessions",
      defaultMode: "candidates",
      evidenceFollowUp: "Use the selected candidate more.evidence payload.",
      configEnv: "AGENT_SESSION_SEARCH_CONFIG",
    },
    recommendedCommands: [
      'agent-session-search "auth token timeout" --json',
      'agent-session-search "PR 227 paper-cuts" --json --source codex',
      'agent-session-search "auth token timeout" --json --evidence --path /absolute/session/path.jsonl',
      "agent-session-search capabilities --json",
      "agent-session-search sources --json",
    ],
    healthChecks: [
      "agent-session-search-doctor",
      "agent-session-search-doctor --list-orphans",
    ],
    commonNextSteps: [
      "Start with candidates mode.",
      "Use focused evidence with a candidate path before broad evidence.",
      "If every source fails, use the all_sources_failed rg fallback command from warnings.",
    ],
  };
}

export function doctorHelpText() {
  return [
    "Usage: agent-session-search-doctor [--command <bin>] [--skip-smoke] [--list-orphans] [--reap-orphans]",
    "       agent-session-search-doctor help",
    "",
    "Verify the FFF backend used by agent-session-search.",
    "",
    "Options:",
    "  --command <bin>       Check a specific fff-mcp binary. Defaults to fff-mcp.",
    "  --skip-smoke          Skip the live temporary-file grep smoke test.",
    "  --list-orphans        List orphaned fff-mcp processes after preflight.",
    "  --reap-orphans        Kill orphaned fff-mcp processes after preflight.",
    "  -h, --help            Show this help.",
    "",
    "Examples:",
    "  agent-session-search-doctor",
    "  agent-session-search-doctor --list-orphans",
    "  agent-session-search-doctor --command /usr/local/bin/fff-mcp --skip-smoke",
  ].join("\n");
}

export function mcpSearchSessionsDescription() {
  return [
    "Search local coding-agent session history across configured sources.",
    "This is an agentic recall tool: when the user request is conversational or underspecified, infer the operational context from your environment and pass several short literal probes in `queries`.",
    "Set `query` to a concise recall task, not the full prompt or response-format instructions. Strip tool-use directions, output-format requests, and examples from `query`.",
    "Use `operationalContext` for useful context such as cwd, repo/project, branch, recent chat, why the user is searching, and any relevant prompt details that should not become search text.",
    "If `queries` is omitted, the tool falls back to deterministic rewriting of `query`.",
    "The default `resultsDisplayMode` is `candidates`: compact session-level leads grouped by source/path. Use `resultsShape` to distinguish candidates, grouped evidence, and raw evidence hits. Use a candidate `more.evidence` object as the next tool input when you need matching snippets from a selected session. Unscoped evidence searches are grouped by path and capped by default; pass `paths` for focused raw evidence. Explicit `maxResultsPerSource` still caps focused evidence per source, not per path. Use `debug` only when inspecting query expansion or backend behavior.",
  ].join(" ");
}
