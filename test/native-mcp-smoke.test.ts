import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { FFF_NATIVE_METADATA_KEY } from "../src/fff-native-policy.js";

const execFileAsync = promisify(execFile);

describe("native MCP stdio smoke path", () => {
  it("exits with the pre-handshake FFF compatibility code when fff-mcp is missing", async () => {
    const tmp = await mkdtemp(
      join(tmpdir(), "agent-session-search-native-preflight-")
    );
    const emptyBin = join(tmp, "bin");
    const configPath = join(tmp, "config.json");
    const root = join(tmp, "root");
    await mkdir(emptyBin);
    await mkdir(root);
    await writeFile(
      configPath,
      JSON.stringify({ roots: [{ name: "empty", path: root }] })
    );

    const result = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/native-server.ts"],
      {
        cwd: process.cwd(),
        env: {
          PATH: emptyBin,
          AGENT_SESSION_SEARCH_CONFIG: configPath,
          NODE_NO_WARNINGS: "1",
        },
      }
    ).catch((error: unknown) => {
      const execError = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      expect(execError.code).toBe(3);
      return {
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
      };
    });

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("fff-mcp was not found on PATH");
  }, 60_000);

  it("lists native tools and calls fff_grep against a fixture root", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-native-"));
    const root = join(tmp, "sessions");
    const db = join(tmp, "fff-db");
    const configPath = join(tmp, "config.json");
    await mkdir(root);
    await mkdir(db);
    await writeFile(
      join(root, "session.jsonl"),
      "before\nnative raw smoke token\nafter\n"
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
      args: ["--import", "tsx", "src/native-server.ts"],
      cwd: process.cwd(),
      env: fixtureSearchEnv(configPath, db),
      stderr: "pipe",
    });
    const client = new Client({
      name: "agent-session-search-native-smoke",
      version: "0.1.0",
    });

    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toMatchObject({
        name: "agent-session-search-native",
      });
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["fff_native_capabilities", "fff_grep"])
      );
      const grep = tools.tools.find((tool) => tool.name === "fff_grep");
      expect((grep?.inputSchema.properties as any).source.enum).toContain(
        "smoke"
      );

      const capabilities = await client.callTool({
        name: "fff_native_capabilities",
        arguments: {},
      });
      const capabilityText = (capabilities as CallToolResult).content.find(
        (entry): entry is { type: "text"; text: string } =>
          entry.type === "text"
      ) as { text: string } | undefined;
      expect(JSON.parse(capabilityText?.text ?? "{}")).toMatchObject({
        coverage: "root-wide",
        sourceCoverage: expect.arrayContaining([
          expect.objectContaining({
            name: "smoke",
            root: canonicalRoot,
            nativeCoverage: "root-wide",
            managedInclude: ["*.jsonl"],
          }),
        ]),
      });

      const result = await eventuallyCallGrep(client, {
        source: "smoke",
        query: "native raw smoke token",
        maxResults: 3,
      });
      expect(JSON.stringify(result.content)).toContain(
        "native raw smoke token"
      );
      expect(result._meta).toMatchObject({
        [FFF_NATIVE_METADATA_KEY]: {
          source: "smoke",
          root: canonicalRoot,
          tool: "grep",
        },
      });
    } finally {
      await client.close();
    }
  }, 60_000);
});

async function eventuallyCallGrep(
  client: Client,
  args: Record<string, unknown>
) {
  let lastResult: any;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    lastResult = await client.callTool({ name: "fff_grep", arguments: args });
    if (JSON.stringify(lastResult.content).includes(String(args.query))) {
      return lastResult;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return lastResult;
}

function fixtureSearchEnv(
  configPath: string,
  db: string
): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      ...process.env,
      AGENT_SESSION_SEARCH_CONFIG: configPath,
      AGENT_SESSION_SEARCH_FFF_DB_DIR: db,
    }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}
