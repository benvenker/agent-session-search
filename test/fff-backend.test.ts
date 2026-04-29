import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
