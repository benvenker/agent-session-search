import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

describe("MCP search_sessions smoke path", () => {
  function candidateLeads(result: { results: any[] }) {
    return result.results.flatMap((entry) =>
      Array.isArray(entry.leads) ? entry.leads : [entry]
    );
  }

  it("describes the search_sessions workflow through tool introspection", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/server.ts"],
      cwd: process.cwd(),
      env: stringEnv(process.env),
      stderr: "pipe",
    });
    const client = new Client({
      name: "agent-session-search-introspection",
      version: "0.1.0",
    });

    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toMatchObject({
        name: "agent-session-search",
        version: packageJson.version,
      });
      const tools = await client.listTools();
      const tool = tools.tools.find((candidate) => {
        return candidate.name === "search_sessions";
      });

      expect(tool?.outputSchema).toBeUndefined();
      expect(tool?.description).toContain("concise recall task");
      expect(tool?.description).toContain("operationalContext");
      expect(tool?.description).toContain("more.evidence");

      const properties = tool?.inputSchema.properties as
        | Record<string, { description?: string }>
        | undefined;
      expect(properties?.query.description).toContain(
        "Concise human-readable recall task"
      );
      expect(properties?.queries.description).toContain(
        "Short literal search probes"
      );
      expect(properties?.operationalContext.description).toContain(
        "cwd, repo, branch"
      );
      expect(properties?.sources.description).toContain(
        "Source names to search"
      );
      expect(properties?.resultsDisplayMode.description).toContain(
        "candidates"
      );
      expect(properties?.paths.description).toContain("Restrict evidence");
    } finally {
      await client.close();
    }
  });

  it("launches the stdio server and searches a deterministic fixture root", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-mcp-"));
    const root = join(tmp, "sessions");
    const db = join(tmp, "fff-db");
    const configPath = join(tmp, "config.json");
    await mkdir(root);
    await mkdir(db);
    await writeFile(
      join(root, "session.jsonl"),
      "before\nauth token timeout smoke\n"
    );
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "smoke", path: root, include: ["*.jsonl"] }],
      })
    );
    const canonicalRoot = await realpath(root);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/server.ts"],
      cwd: process.cwd(),
      env: fixtureSearchEnv(configPath, db),
      stderr: "pipe",
    });
    const client = new Client({
      name: "agent-session-search-smoke",
      version: "0.1.0",
    });

    try {
      await client.connect(transport);
      const result = await eventuallyCallSearchSessions(client, {
        query: "timeout smoke",
        sources: ["smoke"],
        maxResultsPerSource: 3,
      });

      expect(result).toMatchObject({
        query: "timeout smoke",
        resultsDisplayMode: "candidates",
        expandedPatterns: ["timeout smoke", "timeout", "smoke"],
        searchedSources: [
          {
            name: "smoke",
            root: canonicalRoot,
            status: "ok",
          },
        ],
        warnings: [],
      });
      expect((result as any).resultsShape).toBe("candidate_groups");
      expect(candidateLeads(result)).toMatchObject([
        {
          source: "smoke",
          root: canonicalRoot,
          path: join(canonicalRoot, "session.jsonl"),
          line: 2,
          preview: "auth token timeout smoke",
          hitCount: 1,
          matchedQueries: ["timeout smoke"],
          matchedPatterns: ["timeout smoke", "timeout", "smoke"],
          more: {
            evidence: {
              query: "timeout smoke",
              sources: ["smoke"],
              resultsDisplayMode: "evidence",
              paths: [join(canonicalRoot, "session.jsonl")],
            },
          },
        },
      ]);
    } finally {
      await client.close();
    }
  });

  it("returns structured JSON errors for invalid group follow-ups", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-mcp-"));
    const root = join(tmp, "sessions");
    const db = join(tmp, "fff-db");
    const configPath = join(tmp, "config.json");
    await mkdir(root);
    await mkdir(db);
    for (let index = 1; index <= 7; index += 1) {
      await writeFile(
        join(root, `session-${index}.jsonl`),
        `before\nauth token timeout group candidate ${index}\n`
      );
    }
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "smoke", path: root, include: ["*.jsonl"] }],
      })
    );

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/server.ts"],
      cwd: process.cwd(),
      env: fixtureSearchEnv(configPath, db),
      stderr: "pipe",
    });
    const client = new Client({
      name: "agent-session-search-followup-errors",
      version: "0.1.0",
    });

    try {
      await client.connect(transport);
      const firstPage = await eventuallyCallSearchSessions(client, {
        query: "auth token timeout",
        sources: ["smoke"],
        resultsDisplayMode: "candidates",
        maxResultsPerSource: 3,
      });
      const exactGroup = (firstPage as any).results.find(
        (group: any) => group.id === "exact_or_structured"
      );
      const followup = exactGroup?.more?.groupCandidates;

      expect(followup).toMatchObject({
        query: "auth token timeout",
        sources: ["smoke"],
        resultsDisplayMode: "candidates",
        offset: 3,
        limit: 3,
      });

      const editedMode = await callSearchSessionsJson(client, {
        ...groupCandidatesShorthand(followup),
        resultsDisplayMode: "evidence",
      });
      expect(editedMode.output).toMatchObject({ isError: true });
      expect(editedMode.body).toMatchObject({
        error: {
          code: "invalid_group_followup",
          invalidField: "resultsDisplayMode",
          message:
            'Invalid group follow-up: group candidate shorthand must use resultsDisplayMode: "candidates".',
          correctedShape: {
            groupCandidates: {
              resultsDisplayMode: "candidates",
            },
          },
        },
      });

      const tamperedFingerprint = await callSearchSessionsJson(client, {
        ...groupCandidatesShorthand(followup),
        fingerprint: "gcf1:tampered",
      });
      expect(tamperedFingerprint.output).toMatchObject({ isError: true });
      expect(tamperedFingerprint.body).toMatchObject({
        error: {
          code: "invalid_group_followup",
          invalidField: "groupCandidates.fingerprint",
          message:
            "Invalid group follow-up: groupCandidates must be copied exactly from the server-prepared payload.",
          correctedShape: {
            groupCandidates: {
              resultsDisplayMode: "candidates",
            },
          },
        },
      });
    } finally {
      await client.close();
    }
  });
});

async function eventuallyCallSearchSessions(
  client: Client,
  input: Record<string, unknown>
) {
  let result = await callSearchSessions(client, input);
  for (
    let attempt = 0;
    attempt < 10 && result.results.length === 0;
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    result = await callSearchSessions(client, input);
  }
  return result;
}

async function callSearchSessions(
  client: Client,
  input: Record<string, unknown>
) {
  const output = await client.callTool({
    name: "search_sessions",
    arguments: input,
  });
  return JSON.parse(toolText(output)) as {
    query: string;
    expandedPatterns: string[];
    searchedSources: unknown[];
    warnings: unknown[];
    results: unknown[];
  };
}

async function callSearchSessionsJson(
  client: Client,
  input: Record<string, unknown>
) {
  const output = await client.callTool({
    name: "search_sessions",
    arguments: input,
  });
  return {
    output,
    body: JSON.parse(toolText(output)) as unknown,
  };
}

function toolText(output: unknown) {
  const content = (
    output as { content?: Array<{ type: string; text?: string }> }
  ).content;
  const text = content
    ?.filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
  if (!text) {
    throw new Error("search_sessions did not return text content");
  }
  return text;
}

function groupCandidatesShorthand(followup: any): Record<string, unknown> {
  return {
    query: followup.query,
    ...(followup.queries ? { queries: followup.queries } : {}),
    ...(followup.operationalContext !== undefined
      ? { operationalContext: followup.operationalContext }
      : {}),
    ...(followup.sources ? { sources: followup.sources } : {}),
    resultsDisplayMode: followup.resultsDisplayMode,
    ...(followup.paths ? { paths: followup.paths } : {}),
    ...(followup.maxPatterns !== undefined
      ? { maxPatterns: followup.maxPatterns }
      : {}),
    ...(followup.maxResultsPerSource !== undefined
      ? { maxResultsPerSource: followup.maxResultsPerSource }
      : {}),
    ...(followup.context !== undefined ? { context: followup.context } : {}),
    planFingerprint: followup.planFingerprint,
    fingerprint: followup.fingerprint,
    group: followup.group,
    offset: followup.offset,
    limit: followup.limit,
  };
}

function fixtureSearchEnv(
  configPath: string,
  db: string
): Record<string, string> {
  return stringEnv({
    ...process.env,
    AGENT_SESSION_SEARCH_CONFIG: configPath,
    AGENT_SESSION_SEARCH_FFF_DB_DIR: db,
    AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_ATTEMPTS: "10",
    AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_DELAY_MS: "25",
  });
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}
