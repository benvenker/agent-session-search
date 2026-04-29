import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

describe("MCP search_sessions smoke path", () => {
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
      command: join(process.cwd(), "node_modules", ".bin", "tsx"),
      args: ["src/server.ts"],
      cwd: process.cwd(),
      env: stringEnv({
        ...process.env,
        AGENT_SESSION_SEARCH_CONFIG: configPath,
        AGENT_SESSION_SEARCH_FFF_DB_DIR: db,
        AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_ATTEMPTS: "10",
        AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_DELAY_MS: "25",
      }),
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
        expandedPatterns: ["timeout smoke"],
        searchedSources: [
          {
            name: "smoke",
            root: canonicalRoot,
            status: "ok",
          },
        ],
        warnings: [],
      });
      expect(result.results).toEqual([
        {
          source: "smoke",
          root: canonicalRoot,
          path: join(canonicalRoot, "session.jsonl"),
          line: 2,
          preview: "auth token timeout smoke",
          hitCount: 1,
          matchedQueries: [],
          matchedPatterns: ["timeout smoke"],
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
  return JSON.parse(text) as {
    query: string;
    expandedPatterns: string[];
    searchedSources: unknown[];
    warnings: unknown[];
    results: unknown[];
  };
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}
