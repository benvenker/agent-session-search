import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  createFffMcpClient,
  FffMcpClient,
  OneRootFffBackend,
  type FffClient,
} from "../src/fff-backend.js";
import { getTrackedChildProcessPids } from "../src/child-process-cleanup.js";

describe("OneRootFffBackend", () => {
  it("normalizes one-root FFF grep output into session search results", async () => {
    const calls: unknown[] = [];
    const client: FffClient = {
      async grep(input) {
        calls.push(input);
        return {
          content: [
            {
              type: "text",
              text: "sessions/codex.jsonl\n 12: auth token expired\n 18: auth token refreshed",
            },
          ],
          isError: false,
        };
      },
    };

    const backend = new OneRootFffBackend({
      source: "codex",
      root: "/tmp/session-root",
      client,
    });

    await expect(
      backend.search({ patterns: ["auth token"], maxResults: 5 })
    ).resolves.toEqual({
      backend: { mode: "sequential_grep" },
      warnings: [],
      results: [
        {
          source: "codex",
          root: "/tmp/session-root",
          path: "/tmp/session-root/sessions/codex.jsonl",
          line: 12,
          content: "auth token expired",
          pattern: "auth token",
        },
        {
          source: "codex",
          root: "/tmp/session-root",
          path: "/tmp/session-root/sessions/codex.jsonl",
          line: 18,
          content: "auth token refreshed",
          pattern: "auth token",
        },
      ],
    });
    expect(calls).toEqual([{ query: "auth token", maxResults: 5 }]);
  });

  it("returns a structured warning when FFF reports an error", async () => {
    const client: FffClient = {
      async grep() {
        return {
          content: [{ type: "text", text: "grep failed: index unavailable" }],
          isError: true,
        };
      },
    };

    const backend = new OneRootFffBackend({
      source: "claude",
      root: "/tmp/claude-root",
      client,
    });

    await expect(backend.search({ patterns: ["auth token"] })).resolves.toEqual(
      {
        backend: { mode: "sequential_grep" },
        warnings: [
          {
            source: "claude",
            root: "/tmp/claude-root",
            code: "fff_backend_error",
            message: "grep failed: index unavailable",
          },
        ],
        results: [],
      }
    );
  });

  it("returns a timeout warning when the FFF client does not respond", async () => {
    const client: FffClient = {
      async grep() {
        return new Promise(() => {});
      },
    };

    const backend = new OneRootFffBackend({
      source: "pi",
      root: "/tmp/pi-root",
      client,
      timeoutMs: 1,
    });

    await expect(backend.search({ patterns: ["auth token"] })).resolves.toEqual(
      {
        backend: { mode: "sequential_grep" },
        warnings: [
          {
            source: "pi",
            root: "/tmp/pi-root",
            code: "fff_backend_timeout",
            message:
              "FFF backend timed out after 1ms while searching for pattern: auth token",
          },
        ],
        results: [],
      }
    );
  });

  it("applies the result cap across multiple literal patterns", async () => {
    const calls: unknown[] = [];
    const client: FffClient = {
      async grep(input) {
        calls.push(input);
        return {
          content: [
            {
              type: "text",
              text: `${input.query}.jsonl\n 1: ${input.query} content`,
            },
          ],
          isError: false,
        };
      },
    };

    const backend = new OneRootFffBackend({
      source: "codex",
      root: "/tmp/session-root",
      client,
    });

    const result = await backend.search({
      patterns: ["first", "second"],
      maxResults: 1,
    });

    expect(result.results).toEqual([
      {
        source: "codex",
        root: "/tmp/session-root",
        path: "/tmp/session-root/first.jsonl",
        line: 1,
        content: "first content",
        pattern: "first",
      },
    ]);
    expect(result.warnings).toEqual([]);
    expect(calls).toEqual([{ query: "first", maxResults: 1 }]);
  });

  it("promotes multi_grep when it is recall-equivalent and records all matched patterns on one physical line", async () => {
    const calls: unknown[] = [];
    const client: FffClient = {
      async grep(input) {
        calls.push({ tool: "grep", ...input });
        return {
          content: [
            {
              type: "text",
              text: "session.jsonl\n 7: auth token timeout",
            },
          ],
          isError: false,
        };
      },
      async multiGrep(input) {
        calls.push({ tool: "multi_grep", ...input });
        return {
          content: [
            {
              type: "text",
              text: "session.jsonl\n 7: auth token timeout",
            },
          ],
          isError: false,
        };
      },
      async listTools() {
        return [tool("grep"), tool("multi_grep")];
      },
    };

    const backend = new OneRootFffBackend({
      source: "codex",
      root: "/tmp/session-root",
      client,
    });

    await expect(
      backend.search({ patterns: ["auth", "token"], maxResults: 5 })
    ).resolves.toEqual({
      backend: { mode: "multi_grep" },
      warnings: [],
      results: [
        {
          source: "codex",
          root: "/tmp/session-root",
          path: "/tmp/session-root/session.jsonl",
          line: 7,
          content: "auth token timeout",
          pattern: "auth",
          patterns: ["auth", "token"],
        },
      ],
    });
    expect(calls).toEqual([
      { tool: "grep", query: "auth", maxResults: 5 },
      { tool: "grep", query: "token", maxResults: 4 },
      { tool: "multi_grep", patterns: ["auth", "token"], maxResults: 5 },
    ]);

    calls.length = 0;
    await expect(
      backend.search({ patterns: ["auth", "token"], maxResults: 5 })
    ).resolves.toMatchObject({
      backend: { mode: "multi_grep" },
      warnings: [],
    });
    expect(calls).toEqual([
      { tool: "multi_grep", patterns: ["auth", "token"], maxResults: 5 },
    ]);
  });

  it("falls back to sequential grep when multi_grep fails the recall-equivalence probe", async () => {
    const client: FffClient = {
      async grep(input) {
        return {
          content: [
            {
              type: "text",
              text: `${input.query}.jsonl\n 1: ${input.query} content`,
            },
          ],
          isError: false,
        };
      },
      async multiGrep() {
        return {
          content: [
            {
              type: "text",
              text: "first.jsonl\n 1: first content",
            },
          ],
          isError: false,
        };
      },
      async listTools() {
        return [tool("grep"), tool("multi_grep")];
      },
    };

    const backend = new OneRootFffBackend({
      source: "codex",
      root: "/tmp/session-root",
      client,
    });

    const result = await backend.search({
      patterns: ["first", "second"],
      maxResults: 5,
    });

    expect(result.backend).toEqual({
      mode: "sequential_grep_fallback",
      fallbackReason: "multi_grep_recall_probe_failed",
    });
    expect(result.warnings).toMatchObject([
      {
        source: "codex",
        root: "/tmp/session-root",
        code: "multi_grep_fallback",
        recommendedAction: expect.stringContaining("Sequential grep"),
      },
    ]);
    expect(result.results.map((hit) => hit.pattern)).toEqual([
      "first",
      "second",
    ]);
  });

  it("filters paths and include patterns before applying the caller result cap", async () => {
    const calls: unknown[] = [];
    const client: FffClient = {
      async grep(input) {
        calls.push(input);
        return {
          content: [
            {
              type: "text",
              text: [
                "logs/session.txt",
                " 1: auth token timeout",
                "sessions/selected.jsonl",
                " 2: auth token timeout",
              ].join("\n"),
            },
          ],
          isError: false,
        };
      },
    };

    const backend = new OneRootFffBackend({
      source: "codex",
      root: "/tmp/session-root",
      client,
    });

    const result = await backend.search({
      patterns: ["auth token"],
      maxResults: 1,
      paths: ["/tmp/session-root/sessions/selected.jsonl"],
      include: ["*.jsonl"],
    });

    expect(result.results).toEqual([
      {
        source: "codex",
        root: "/tmp/session-root",
        path: "/tmp/session-root/sessions/selected.jsonl",
        line: 2,
        content: "auth token timeout",
        pattern: "auth token",
      },
    ]);
    expect(calls).toEqual([{ query: "auth token", maxResults: undefined }]);
  });

  it("filters include patterns before applying the caller result cap", async () => {
    const calls: unknown[] = [];
    const client: FffClient = {
      async grep(input) {
        calls.push(input);
        return {
          content: [
            {
              type: "text",
              text: [
                "config.json",
                " 1: auth token timeout",
                "sessions/selected.jsonl",
                " 2: auth token timeout",
              ].join("\n"),
            },
          ],
          isError: false,
        };
      },
    };

    const backend = new OneRootFffBackend({
      source: "codex",
      root: "/tmp/session-root",
      client,
    });

    const result = await backend.search({
      patterns: ["auth token"],
      maxResults: 1,
      include: ["sessions/*.jsonl"],
    });

    expect(result.results).toEqual([
      {
        source: "codex",
        root: "/tmp/session-root",
        path: "/tmp/session-root/sessions/selected.jsonl",
        line: 2,
        content: "auth token timeout",
        pattern: "auth token",
      },
    ]);
    expect(calls).toEqual([{ query: "auth token", maxResults: undefined }]);
  });

  it("retries empty results only while warming up the first pattern", async () => {
    const calls: unknown[] = [];
    const client: FffClient = {
      async grep(input) {
        calls.push(input);
        return {
          content: [],
          isError: false,
        };
      },
    };

    const backend = new OneRootFffBackend({
      source: "codex",
      root: "/tmp/session-root",
      client,
      emptyResultRetryAttempts: 2,
      emptyResultRetryDelayMs: 1,
    });

    await expect(
      backend.search({ patterns: ["first", "second"], maxResults: 5 })
    ).resolves.toEqual({
      backend: {
        mode: "sequential_grep_fallback",
        fallbackReason: "multi_grep_unavailable",
      },
      warnings: [],
      results: [],
    });
    expect(calls).toEqual([
      { query: "first", maxResults: 5 },
      { query: "first", maxResults: 5 },
      { query: "first", maxResults: 5 },
      { query: "second", maxResults: 5 },
    ]);
  });

  it("closes the underlying FFF client when the backend is closed", async () => {
    const calls: string[] = [];
    const client: FffClient = {
      async grep() {
        throw new Error("not used");
      },
      async close() {
        calls.push("close");
      },
    };

    const backend = new OneRootFffBackend({
      source: "codex",
      root: "/tmp/session-root",
      client,
    });

    await backend.close();

    expect(calls).toEqual(["close"]);
  });

  it("maps grep calls and close to the MCP client", async () => {
    const calls: unknown[] = [];
    const mcpClient = {
      async callTool(input: unknown) {
        calls.push(input);
        return {
          content: [{ type: "text", text: "session.jsonl\n 1: auth token" }],
          isError: false,
        };
      },
      async close() {
        calls.push("close");
      },
    };

    const client = new FffMcpClient(mcpClient);

    await expect(
      client.grep({ query: "auth token", maxResults: 2 })
    ).resolves.toEqual({
      content: [{ type: "text", text: "session.jsonl\n 1: auth token" }],
      isError: false,
    });
    await client.close();

    expect(calls).toEqual([
      {
        name: "grep",
        arguments: {
          query: "auth token",
          maxResults: 2,
        },
      },
      "close",
    ]);
  });

  it("lists complete paginated MCP tool definitions", async () => {
    const calls: unknown[] = [];
    const mcpClient = {
      async callTool() {
        throw new Error("not used");
      },
      async listTools(input: { cursor?: string } = {}) {
        calls.push(input);
        if (!input.cursor) {
          return {
            tools: [
              {
                name: "grep",
                description: "Search files",
                inputSchema: {
                  type: "object" as const,
                  properties: { query: { type: "string" } },
                  required: ["query"],
                },
                outputSchema: {
                  type: "object" as const,
                  properties: { hits: { type: "array" } },
                },
                annotations: { readOnlyHint: true },
                execution: { taskSupport: "forbidden" as const },
              },
            ],
            nextCursor: "page-2",
          };
        }
        return {
          tools: [
            {
              name: "multi_grep",
              description: "Search multiple patterns",
              inputSchema: {
                type: "object" as const,
                properties: { patterns: { type: "array" } },
                required: ["patterns"],
              },
              annotations: { readOnlyHint: true },
            },
          ],
        };
      },
      async close() {},
    };

    const client = new FffMcpClient(mcpClient);

    await expect(client.listTools()).resolves.toEqual([
      {
        name: "grep",
        description: "Search files",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        outputSchema: {
          type: "object",
          properties: { hits: { type: "array" } },
        },
        annotations: { readOnlyHint: true },
        execution: { taskSupport: "forbidden" },
      },
      {
        name: "multi_grep",
        description: "Search multiple patterns",
        inputSchema: {
          type: "object",
          properties: { patterns: { type: "array" } },
          required: ["patterns"],
        },
        annotations: { readOnlyHint: true },
      },
    ]);
    expect(calls).toEqual([{}, { cursor: "page-2" }]);
  });

  it("removes an owned temporary FFF database directory when closed", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-cleanup-"));
    await writeFile(join(tmp, "frecency.mdb"), "");
    const client = new FffMcpClient(
      {
        async callTool() {
          throw new Error("not used");
        },
        async close() {},
      },
      tmp
    );

    await client.close();

    await expect(access(tmp)).rejects.toMatchObject({ code: "ENOENT" });
  });

  const liveFffMcp =
    spawnSync("fff-mcp", ["--version"], { stdio: "ignore" }).status === 0;

  (liveFffMcp ? it : it.skip)(
    "tracks and untracks a live fff-mcp child process",
    async () => {
      const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-fff-"));
      const root = join(tmp, "root");
      const db = join(tmp, "db");
      await mkdir(root);
      await mkdir(db);

      const before = new Set(getTrackedChildProcessPids());
      const client = await createFffMcpClient(root, {
        args: [
          "--no-update-check",
          "--frecency-db",
          join(db, "frecency.mdb"),
          "--history-db",
          join(db, "history.mdb"),
        ],
      });
      const trackedAfterCreate = getTrackedChildProcessPids().filter(
        (pid) => !before.has(pid)
      );

      try {
        expect(trackedAfterCreate).toHaveLength(1);
      } finally {
        await client.close();
        await rm(tmp, { recursive: true, force: true });
      }

      expect(getTrackedChildProcessPids()).not.toContain(trackedAfterCreate[0]);
    }
  );

  (liveFffMcp ? it : it.skip)(
    "searches a temporary root through a live fff-mcp child process",
    async () => {
      const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-fff-"));
      const root = join(tmp, "root");
      const db = join(tmp, "db");
      await mkdir(root);
      await mkdir(db);
      await writeFile(
        join(root, "session.jsonl"),
        "before\nauth token smoke\n"
      );

      const client = await createFffMcpClient(root, {
        args: [
          "--no-update-check",
          "--frecency-db",
          join(db, "frecency.mdb"),
          "--history-db",
          join(db, "history.mdb"),
        ],
      });
      const backend = new OneRootFffBackend({
        source: "codex",
        root,
        client,
        timeoutMs: 2_000,
      });

      try {
        const result = await eventuallySearch(backend, {
          patterns: ["smoke"],
          maxResults: 3,
        });
        expect(result).toEqual({
          backend: { mode: "sequential_grep" },
          warnings: [],
          results: [
            {
              source: "codex",
              root,
              path: join(root, "session.jsonl"),
              line: 2,
              content: "auth token smoke",
              pattern: "smoke",
            },
          ],
        });
      } finally {
        await backend.close();
      }
    }
  );
});

async function eventuallySearch(
  backend: OneRootFffBackend,
  input: { patterns: string[]; maxResults: number }
) {
  let latest = await backend.search(input);
  for (
    let attempt = 0;
    attempt < 10 && latest.results.length === 0;
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    latest = await backend.search(input);
  }
  return latest;
}

function tool(name: string) {
  return {
    name,
    inputSchema: {
      type: "object" as const,
    },
  };
}
