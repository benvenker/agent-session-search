import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

describe("MCP server FFF client pooling", () => {
  it("keeps one temporary FFF database directory warm across repeated searches", async () => {
    const tmp = await mkdtemp(
      join(tmpdir(), "agent-session-search-server-pool-")
    );
    const root = join(tmp, "sessions");
    const configPath = join(tmp, "config.json");
    const fffTmp = join(tmp, "fff-tmp");
    await mkdir(root);
    await mkdir(fffTmp);
    const token = `server-pool-token-${process.pid}`;
    await writeFile(
      join(root, "session.jsonl"),
      `${token} first\n${token} second\n`
    );
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "smoke", path: root, include: ["*.jsonl"] }],
      })
    );

    let stderr = "";
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/server.ts"],
      cwd: process.cwd(),
      env: stringEnv({
        ...process.env,
        TMPDIR: `${fffTmp}/`,
        AGENT_SESSION_SEARCH_CONFIG: configPath,
        AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_ATTEMPTS: "10",
        AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_DELAY_MS: "25",
      }),
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    const client = new Client({
      name: "agent-session-search-pool-smoke",
      version: "0.1.0",
    });

    try {
      try {
        await client.connect(transport);
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nstderr:\n${stderr}`
        );
      }
      await eventuallyCallSearchSessions(client, {
        query: `${token} first`,
        sources: ["smoke"],
      });
      await eventuallyCallSearchSessions(client, {
        query: `${token} second`,
        sources: ["smoke"],
      });

      const dbDirs = (await readdir(fffTmp)).filter((entry) =>
        entry.startsWith("agent-session-search-fff-")
      );
      expect(dbDirs).toHaveLength(1);
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
  expect(result.results.length).toBeGreaterThan(0);
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
  return JSON.parse(text) as { results: unknown[] };
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}
