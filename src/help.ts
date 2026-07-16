export function cliHelpText() {
  return [
    "Usage: agent-session-search <query> [--json] [--source <source>...] [--mode <candidates|evidence|debug>] [--path <path>...] [--max-results <n>]",
    "       agent-session-search --json --group-candidates <json|@file|->",
    "       agent-session-search help",
    "       agent-session-search --version",
    "       agent-session-search sources [--json]",
    "       agent-session-search capabilities [--json]",
    "       agent-session-search robot-docs guide",
    "       agent-session-search --robot-triage",
    "",
    "Search local coding-agent session history through the same engine as the MCP server.",
    "",
    "Commands:",
    "  help                       Show this help.",
    "  version                    Print the package version.",
    "  sources [--json]           Inspect configured source roots without running a search.",
    "  capabilities [--json]      Print the agent-readable CLI and MCP contract.",
    "  robot-docs guide           Print the in-tool guide for coding agents.",
    "",
    "Options:",
    "  --json                     Print the full search result as JSON.",
    "  --robot-triage             Print quick reference, commands, and health checks as JSON.",
    "  --source <source>          Restrict search to a source. Repeat for multiple sources.",
    "  --probe <query>            Add an agent-planned literal probe. Repeat for multiple probes. Alias: --query.",
    "  --cwd <path>               Add cwd to operationalContext.",
    "  --branch <name>            Add branch to operationalContext.",
    "  --reason <text>            Add search reason to operationalContext.",
    "  --caller-source <source>   Source name for reliable current-session demotion.",
    "  --caller-session-id <id>   Live caller session id for current-session demotion; requires --caller-source.",
    "  --group-candidates <json|@file|->",
    "                             Replay a server-prepared more.groupCandidates payload to expand one candidate group.",
    "  --mode <candidates|evidence|debug>",
    "                             Select result detail. Defaults to candidates.",
    "  --candidates               Return candidate groups with compact session-level leads.",
    "  --evidence                 Return matching snippets, usually with --path.",
    "  --debug                    Return query expansion and diagnostics; combine with --candidates for ranking explanations.",
    "  --path <path>              Restrict evidence to a canonical session path. Repeatable.",
    "  --max-patterns <n>         Limit expanded literal search patterns.",
    "  --max-results <n>          Limit results per source, including focused --path evidence. Alias: --max-results-per-source.",
    "  -h, --help                 Show this help.",
    "  -v, --version              Print the package version.",
    "",
    "Examples:",
    '  agent-session-search "auth token timeout" --json',
    "  agent-session-search capabilities",
    "  agent-session-search sources",
    "  agent-session-search robot-docs guide",
    "  agent-session-search --robot-triage",
    '  agent-session-search "global search" --source codex --source claude',
    "  agent-session-search --json --group-candidates @payload.json",
    '  agent-session-search "auth token timeout" --json --evidence --path /Users/ben/.codex/sessions/session.jsonl',
    "",
    "MCP:",
    "  Run agent-session-search-mcp to expose the search_sessions tool over stdio.",
    "  Use query for a concise recall task, queries for short literal probes, operationalContext for cwd/branch/reason, and callerSession when the caller knows its live session id.",
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
          'agent-session-search "<query>" [--json] [--probe <query>...] [--cwd <path>] [--branch <name>] [--reason <text>] [--caller-source <source> --caller-session-id <id>] [--source <source>...] [--mode <candidates|evidence|debug>] [--path <path>...]',
        output:
          "--json prints the same result envelope as the MCP search_sessions tool.",
      },
      {
        name: "group-candidates follow-up",
        usage: "agent-session-search --json --group-candidates <json|@file|->",
        output:
          "Expands one candidate group from a server-prepared more.groupCandidates payload.",
      },
      {
        name: "sources",
        usage: "agent-session-search sources [--json]",
        output:
          "Machine-readable source-root inspection with enabled, status, include, and warning fields.",
      },
      {
        name: "capabilities",
        usage: "agent-session-search capabilities [--json]",
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
        usage:
          "agent-session-search-doctor [--skip-smoke] [--list-orphans] [--reap-orphans] | agent-session-search-doctor --ensure-fff --yes",
        output:
          "FFF backend setup diagnostics including required v0.9.6 compatibility, explicit repair, multi_grep support, and recall-equivalence status.",
      },
    ],
    resultModes: [
      {
        name: "candidates",
        shape: "candidate_groups",
        use: "Default static match groups with compact leads, more.groupCandidates expansion payloads when more leads are available, and candidate more.evidence follow-ups. Replay a group payload with agent-session-search --json --group-candidates @payload.json or pass it to the MCP search_sessions groupCandidates field. With debug: true, includes ranking explanations under debug.ranking.candidates.",
      },
      {
        name: "evidence",
        shape: "evidence_groups or evidence_hits",
        use: "Matching snippets; pass paths for focused raw evidence hits.",
      },
      {
        name: "debug",
        shape: "evidence_hits",
        use: "Compatibility diagnostics mode for query expansion and backend behavior.",
      },
    ],
    contract: {
      version: "progressive-evidence-groups.v2",
      metadata:
        "Search responses include backend mode, limits, and count semantics.",
      backendModes: [
        "multi_grep",
        "sequential_grep",
        "sequential_grep_fallback",
        "custom",
      ],
      warnings: {
        missing_root:
          "Create the directory, update or disable the source in config, or inspect configured roots with agent-session-search sources --json.",
        unreadable_root:
          "Fix filesystem permissions, update or disable the source in config, or inspect configured roots with agent-session-search sources --json.",
        multi_grep_fallback:
          "Sequential grep is being used because multi_grep was unavailable, failed, or did not pass recall-equivalence gating.",
        no_sources_selected:
          "Omit --source to search all enabled sources, or run agent-session-search sources --json and retry with one enabled source name.",
        invalid_group_followup:
          "Copy the server-prepared more.groupCandidates payload exactly; it includes continuation and query-plan fingerprints.",
        broad_evidence_capped:
          "Switch to candidates mode, expand one more.groupCandidates payload when useful, then request focused evidence for selected paths.",
        all_sources_failed:
          "Run agent-session-search sources --json and agent-session-search-doctor, or use the rg fallback command included in the warning message.",
      },
      warningEnvelope: {
        fields: ["source?", "root?", "code", "message", "recommendedAction?"],
        recovery:
          "When recommendedAction is present, show it with the warning and prefer it over guessing a repair path.",
      },
    },
    env: [
      {
        name: "AGENT_SESSION_SEARCH_CONFIG",
        use: "Override the JSON source-root config path.",
      },
      {
        name: "AGENT_SESSION_SEARCH_FFF_DB_DIR",
        use: "Override where temporary FFF frecency/history databases are written.",
      },
      {
        name: "AGENT_SESSION_SEARCH_FFF_TIMEOUT_MS",
        use: "Override the per-pattern FFF timeout in milliseconds.",
      },
      {
        name: "AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_ATTEMPTS",
        use: "Override the retry count for initially empty FFF responses.",
      },
      {
        name: "AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_DELAY_MS",
        use: "Override the delay between initially empty FFF response retries.",
      },
      {
        name: "AGENT_SESSION_SEARCH_CALLER_SOURCE",
        use: "With AGENT_SESSION_SEARCH_CALLER_SESSION_ID, demote the matching current session for any source.",
      },
      {
        name: "AGENT_SESSION_SEARCH_CALLER_SESSION_ID",
        use: "With AGENT_SESSION_SEARCH_CALLER_SOURCE, demote the matching current session for any source.",
      },
      {
        name: "CODEX_THREAD_ID",
        use: "Backward-compatible Codex-only current-session demotion fallback.",
      },
    ],
    exitCodes: [
      { code: 0, meaning: "success" },
      { code: 1, meaning: "user-input-error" },
      { code: 3, meaning: "tool-environment-error" },
      { code: 4, meaning: "upstream-failure" },
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
    "Use `query` for the concise recall task. If you already know useful literal probes, call the MCP `search_sessions` tool with `queries` and `operationalContext` rather than stuffing instructions into `query`. If you know the live caller session, include `callerSession: { source, sessionId }` so current-session echoes are demoted.",
    "",
    "Default result mode is `candidates`. Pick a candidate, then echo its `more.evidence` payload to `search_sessions` or use the matching CLI form:",
    "To expand a promising candidate group from the CLI, save the group's `more.groupCandidates` payload and run:",
    "  agent-session-search --json --group-candidates @payload.json",
    "",
    "For line-level evidence, echo a selected candidate's `more.evidence` payload to `search_sessions` or use the matching CLI form:",
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
    "- Candidate ranking uses recency, hit density, project matches, explicit callerSession current-session demotion for any source, and CODEX_THREAD_ID as a Codex fallback.",
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
      resultShape: "candidate_groups",
      groupFollowUp:
        "Use a group more.groupCandidates payload under groupCandidates, echo that payload exactly to MCP, or run agent-session-search --json --group-candidates @payload.json in the CLI.",
      evidenceFollowUp:
        "Use the selected candidate more.evidence payload for focused line evidence.",
      configEnv: "AGENT_SESSION_SEARCH_CONFIG",
    },
    recommendedCommands: [
      'agent-session-search "auth token timeout" --json',
      'agent-session-search "PR 227 paper-cuts" --json --source codex',
      "agent-session-search --json --group-candidates @payload.json",
      'agent-session-search "auth token timeout" --json --evidence --path /absolute/session/path.jsonl',
      "agent-session-search capabilities --json",
      "agent-session-search sources --json",
    ],
    healthChecks: [
      "agent-session-search-doctor",
      "agent-session-search-doctor --ensure-fff --yes",
      "agent-session-search-doctor --list-orphans",
    ],
    commonNextSteps: [
      "Start with candidates mode and inspect candidate_groups in priority order.",
      "Expand a promising group with more.groupCandidates before focused evidence when the first leads are thin; from the CLI, use --group-candidates @payload.json.",
      "Use focused evidence with a candidate path before broad evidence.",
      "If every source fails, use the all_sources_failed rg fallback command from warnings.",
    ],
  };
}

export function doctorHelpText() {
  return [
    "Usage: agent-session-search-doctor [--command <bin>] [--skip-smoke] [--list-orphans] [--reap-orphans]",
    "       agent-session-search-doctor --ensure-fff --yes",
    "       agent-session-search-doctor help",
    "",
    "Verify the FFF backend used by agent-session-search.",
    "Fails when fff-mcp is missing or below the required minimum. Reports installed version, stable release guidance, multi_grep support, and recall-equivalence status without upgrading automatically.",
    "",
    "Options:",
    "  --command <bin>       Check a specific fff-mcp binary. Defaults to fff-mcp.",
    "  --skip-smoke          Skip the live temporary-file grep smoke test.",
    "  --ensure-fff          Run the official FFF MCP installer when repair is needed. Requires --yes.",
    "  --yes                 Confirm --ensure-fff may install or upgrade fff-mcp.",
    "  --list-orphans        List orphaned fff-mcp processes after preflight.",
    "  --reap-orphans        Kill orphaned fff-mcp processes after preflight.",
    "  -h, --help            Show this help.",
    "",
    "Examples:",
    "  agent-session-search-doctor",
    "  agent-session-search-doctor --ensure-fff --yes",
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
    "Use `callerSession` only when you know the live caller source and session id; matching candidates are demoted so the current transcript does not crowd out older useful sessions.",
    "If `queries` is omitted, the tool falls back to deterministic rewriting of `query`.",
    'The default `resultsDisplayMode` is `candidates` with `resultsShape: "candidate_groups"`: static match groups ordered from exact/structured evidence through looser fallbacks. Expand a group by passing its `more.groupCandidates` payload under `groupCandidates`, or by echoing that payload exactly when your MCP client supports top-level shorthand, then use a candidate `more.evidence` object when you need matching snippets from a selected session. Unscoped evidence searches are grouped by path and capped by default; pass `paths` for focused raw evidence. Explicit `maxResultsPerSource` still caps focused evidence per source, not per path. Use `debug` only when inspecting query expansion or backend behavior; candidate-mode debug also returns compact ranking explanations.',
  ].join(" ");
}
