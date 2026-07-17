import { describe, expect, it } from "vitest";
import { FffCapabilityRouter } from "../src/fff-capability-router.js";
import type { FffClient } from "../src/fff-backend.js";
import type { ResolvedSessionSource } from "../src/roots.js";

describe("FffCapabilityRouter", () => {
  it("discovers complete tool schemas from the first healthy source", async () => {
    const client = fakeClient({
      tools: [
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
      ],
    });
    const router = new FffCapabilityRouter({
      sources: [source("codex", "/tmp/codex")],
      async clientForRoot() {
        return client;
      },
    });

    await expect(router.listTools()).resolves.toEqual([
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
    ]);
  });

  it("falls through discovery failures without merging heterogeneous tool sets", async () => {
    const calls: string[] = [];
    const router = new FffCapabilityRouter({
      sources: [source("codex", "/tmp/codex"), source("claude", "/tmp/claude")],
      async clientForRoot(root) {
        calls.push(root);
        if (root === "/tmp/codex") {
          return fakeClient({ listError: new Error("index down") });
        }
        return fakeClient({ tools: [tool("grep")] });
      },
    });

    await expect(router.listTools()).resolves.toEqual([tool("grep")]);
    expect(calls).toEqual(["/tmp/codex", "/tmp/claude"]);
    expect(router.getWarnings()).toMatchObject([
      {
        source: "codex",
        root: "/tmp/codex",
        code: "fff_tool_discovery_failed",
      },
    ]);
  });

  it("routes calls to the requested source root and preserves upstream errors", async () => {
    const calls: unknown[] = [];
    const router = new FffCapabilityRouter({
      sources: [source("codex", "/tmp/codex"), source("claude", "/tmp/claude")],
      async clientForRoot(root) {
        return fakeClient({
          async callTool(input) {
            calls.push({ root, input });
            return root === "/tmp/claude"
              ? { isError: true, content: [{ type: "text", text: "failed" }] }
              : { content: [{ type: "text", text: "ok" }] };
          },
        });
      },
    });

    await expect(
      router.call("codex", "grep", { query: "alpha" })
    ).resolves.toEqual({
      source: "codex",
      root: "/tmp/codex",
      tool: "grep",
      result: { content: [{ type: "text", text: "ok" }] },
    });
    await expect(
      router.call("claude", "grep", { query: "beta" })
    ).resolves.toMatchObject({
      source: "claude",
      root: "/tmp/claude",
      result: { isError: true },
    });
    expect(calls).toEqual([
      {
        root: "/tmp/codex",
        input: { name: "grep", arguments: { query: "alpha" } },
      },
      {
        root: "/tmp/claude",
        input: { name: "grep", arguments: { query: "beta" } },
      },
    ]);
  });

  it("caches repeated discovery and coalesces concurrent first discovery", async () => {
    let listCalls = 0;
    let resolveList: ((tools: ReturnType<typeof tool>[]) => void) | undefined;
    const router = new FffCapabilityRouter({
      sources: [source("codex", "/tmp/codex")],
      async clientForRoot() {
        return fakeClient({
          async listTools() {
            listCalls += 1;
            return new Promise((resolve) => {
              resolveList = resolve;
            });
          },
        });
      },
    });

    const first = router.listTools("codex");
    const second = router.listTools("codex");
    await Promise.resolve();
    expect(listCalls).toBe(1);
    resolveList?.([tool("grep")]);
    await expect(first).resolves.toEqual([tool("grep")]);
    await expect(second).resolves.toEqual([tool("grep")]);
    await expect(router.listTools("codex")).resolves.toEqual([tool("grep")]);
    expect(listCalls).toBe(1);
  });

  it("defensively copies source snapshots and cached tool definitions", async () => {
    const sources = [source("codex", "/tmp/codex")];
    sources[0]!.include = ["sessions/**"];
    const cachedTool = tool("grep");
    const router = new FffCapabilityRouter({
      sources,
      async clientForRoot() {
        return fakeClient({ tools: [cachedTool] });
      },
    });

    sources[0]!.include!.push("outside/**");
    const listedSources = router.listSources();
    listedSources[0]!.include!.push("mutated/**");
    expect(router.listSources()[0]!.include).toEqual(["sessions/**"]);

    const firstTools = await router.listTools("codex");
    (firstTools[0]!.inputSchema as { type: string }).type = "mutated";
    (cachedTool.inputSchema as { type: string }).type = "mutated";
    const secondTools = await router.listTools("codex");
    expect(secondTools).toEqual([tool("grep")]);
  });

  it("retries discovery after a failed first attempt", async () => {
    let listCalls = 0;
    const router = new FffCapabilityRouter({
      sources: [source("codex", "/tmp/codex")],
      async clientForRoot() {
        return fakeClient({
          async listTools() {
            listCalls += 1;
            if (listCalls === 1) {
              throw new Error("temporary discovery failure");
            }
            return [tool("grep")];
          },
        });
      },
    });

    await expect(router.listTools("codex")).rejects.toThrow(
      "temporary discovery failure"
    );
    await expect(router.listTools("codex")).resolves.toEqual([tool("grep")]);
    expect(listCalls).toBe(2);
  });

  it("rejects unknown and unhealthy sources before creating clients", async () => {
    const calls: string[] = [];
    const router = new FffCapabilityRouter({
      sources: [source("codex", "/tmp/codex", "missing")],
      async clientForRoot(root) {
        calls.push(root);
        return fakeClient({});
      },
    });

    await expect(router.call("unknown", "grep", {})).rejects.toThrow(
      "Unknown session source"
    );
    await expect(router.call("codex", "grep", {})).rejects.toThrow(
      "not searchable"
    );
    expect(calls).toEqual([]);
  });
});

function source(
  name: string,
  root: string,
  status: ResolvedSessionSource["status"] = "ok"
): ResolvedSessionSource {
  return { name, root, status };
}

function tool(name: string) {
  return { name, inputSchema: { type: "object" as const } };
}

function fakeClient(options: {
  tools?: Awaited<ReturnType<NonNullable<FffClient["listTools"]>>>;
  listError?: Error;
  listTools?: NonNullable<FffClient["listTools"]>;
  callTool?: NonNullable<FffClient["callTool"]>;
}): FffClient {
  return {
    async grep() {
      throw new Error("not used");
    },
    async listTools() {
      if (options.listTools) {
        return options.listTools();
      }
      if (options.listError) {
        throw options.listError;
      }
      return options.tools ?? [];
    },
    async callTool(input) {
      return options.callTool
        ? options.callTool(input)
        : { content: [{ type: "text", text: "ok" }] };
    },
  };
}
