import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { FffCapabilityRouter } from "../src/fff-capability-router.js";
import {
  FFF_NATIVE_METADATA_KEY,
  NativeCallBudget,
  SUPPORTED_FFF_GREP_TOOL,
  SUPPORTED_FFF_MULTI_GREP_TOOL,
} from "../src/fff-native-policy.js";
import { createNativeServer } from "../src/native-server.js";
import type { SourceName } from "../src/types.js";

describe("native MCP server", () => {
  it("lists diagnostics and approved source-bound namespaced tools", async () => {
    const client = await connectNativeClient(
      fakeRouter({
        tools: [SUPPORTED_FFF_GREP_TOOL, SUPPORTED_FFF_MULTI_GREP_TOOL],
      })
    );

    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        "fff_native_capabilities",
        "fff_grep",
        "fff_multi_grep",
      ]);
      const grep = listed.tools.find((tool) => tool.name === "fff_grep");
      expect(grep?.inputSchema.required).toContain("source");
      expect((grep?.inputSchema.properties as any).source.enum).toEqual([
        "codex",
      ]);
      expect(grep?.description).toContain("root-wide");
    } finally {
      await client.close();
    }
  });

  it("routes valid calls without mutating upstream args and adds native metadata", async () => {
    const calls: Array<{ source: SourceName; tool: string; args: unknown }> =
      [];
    const client = await connectNativeClient(
      fakeRouter({
        tools: [SUPPORTED_FFF_GREP_TOOL],
        calls,
        result: {
          content: [{ type: "text", text: "match" }],
          structuredContent: { hits: 1 },
          _meta: { upstream: true },
        } as CallToolResult,
      })
    );

    try {
      const result = await client.callTool({
        name: "fff_grep",
        arguments: { source: "codex", query: "auth token" },
      });

      expect(calls).toEqual([
        {
          source: "codex",
          tool: "grep",
          args: { query: "auth token", maxResults: 50 },
        },
      ]);
      expect(result).toMatchObject({
        content: [{ type: "text", text: "match" }],
        structuredContent: { hits: 1 },
        _meta: {
          upstream: true,
          [FFF_NATIVE_METADATA_KEY]: {
            source: "codex",
            root: "/tmp/codex",
            tool: "grep",
          },
        },
      });
    } finally {
      await client.close();
    }
  });

  it("keeps drifted tools out of tools/list and reports diagnostics", async () => {
    const drifted = {
      ...SUPPORTED_FFF_GREP_TOOL,
      description: `${SUPPORTED_FFF_GREP_TOOL.description} drift`,
    };
    const client = await connectNativeClient(fakeRouter({ tools: [drifted] }));

    try {
      await expect(
        client.callTool({
          name: "fff_grep",
          arguments: { source: "codex", query: "auth" },
        })
      ).rejects.toThrow(/Unknown native FFF tool/);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        "fff_native_capabilities",
      ]);
      const capabilities = await client.callTool({
        name: "fff_native_capabilities",
        arguments: {},
      });
      expect(
        JSON.parse(textContent(capabilities as CallToolResult))
      ).toMatchObject({
        tools: {
          blocked: [
            {
              upstreamName: "grep",
              reason: "definition_drift",
            },
          ],
        },
      });
    } finally {
      await client.close();
    }
  });

  it("rejects invalid arguments before routing and returns bounded budget errors as tool results", async () => {
    const calls: Array<{ source: SourceName; tool: string; args: unknown }> =
      [];
    const client = await connectNativeClient(
      fakeRouter({ tools: [SUPPORTED_FFF_GREP_TOOL], calls }),
      new NativeCallBudget({ maxAttempts: 1 })
    );

    try {
      await expect(
        client.callTool({
          name: "fff_grep",
          arguments: { query: "auth" },
        })
      ).rejects.toThrow(/source/);
      expect(calls).toEqual([]);

      await client.callTool({
        name: "fff_grep",
        arguments: { source: "codex", query: "auth" },
      });
      const exhausted = await client.callTool({
        name: "fff_grep",
        arguments: { source: "codex", query: "auth" },
      });
      expect(exhausted).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "native_call_budget_exhausted" }],
      });
    } finally {
      await client.close();
    }
  });

  it("returns bounded native errors for concurrency overflow, timeout, oversize results, and metadata collisions", async () => {
    const timeoutClient = await connectNativeClient(
      fakeRouter({
        tools: [SUPPORTED_FFF_GREP_TOOL],
        callHandler: () => new Promise(() => {}),
      }),
      new NativeCallBudget({ maxConcurrent: 1, timeoutMs: 1 })
    );

    try {
      const timedOut = await timeoutClient.callTool({
        name: "fff_grep",
        arguments: { source: "codex", query: "auth" },
      });
      expect(timedOut).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "native_call_timeout" }],
      });
      const recovered = await timeoutClient.callTool({
        name: "fff_grep",
        arguments: { source: "codex", query: "auth" },
      });
      expect(recovered).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "native_call_concurrency_exhausted" }],
      });
    } finally {
      await timeoutClient.close();
    }

    const pendingClient = await connectNativeClient(
      fakeRouter({
        tools: [SUPPORTED_FFF_GREP_TOOL],
        callHandler: () => new Promise(() => {}),
      }),
      new NativeCallBudget({ maxConcurrent: 1, timeoutMs: 100 })
    );
    try {
      const first = pendingClient.callTool({
        name: "fff_grep",
        arguments: { source: "codex", query: "auth" },
      });
      const overflow = await pendingClient.callTool({
        name: "fff_grep",
        arguments: { source: "codex", query: "auth" },
      });
      expect(overflow).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "native_call_concurrency_exhausted" }],
      });
      await first;
    } finally {
      await pendingClient.close();
    }

    const oversizeClient = await connectNativeClient(
      fakeRouter({
        tools: [SUPPORTED_FFF_GREP_TOOL],
        result: { content: [{ type: "text", text: "x".repeat(200) }] },
      }),
      new NativeCallBudget({ maxResultBytes: 10 })
    );
    try {
      await expect(
        oversizeClient.callTool({
          name: "fff_grep",
          arguments: { source: "codex", query: "auth" },
        })
      ).resolves.toMatchObject({
        isError: true,
        content: [{ type: "text", text: "native_result_too_large" }],
      });
    } finally {
      await oversizeClient.close();
    }

    const collisionClient = await connectNativeClient(
      fakeRouter({
        tools: [SUPPORTED_FFF_GREP_TOOL],
        result: {
          content: [],
          _meta: { [FFF_NATIVE_METADATA_KEY]: { upstream: true } },
        },
      })
    );
    try {
      await expect(
        collisionClient.callTool({
          name: "fff_grep",
          arguments: { source: "codex", query: "auth" },
        })
      ).resolves.toMatchObject({
        isError: true,
        content: [{ type: "text", text: "native_result_metadata_collision" }],
      });
    } finally {
      await collisionClient.close();
    }
  });

  it("rejects unknown tools and source-specific missing or blocked tools without routing", async () => {
    const calls: Array<{ source: SourceName; tool: string; args: unknown }> =
      [];
    const client = await connectNativeClient(
      fakeRouter({
        toolsBySource: {
          codex: [SUPPORTED_FFF_GREP_TOOL],
          claude: [],
        },
        calls,
        sources: [
          {
            name: "codex" as SourceName,
            root: "/tmp/codex",
            include: ["sessions/*.jsonl"],
            status: "ok",
          },
          {
            name: "claude" as SourceName,
            root: "/tmp/claude",
            include: ["projects/**/*.jsonl"],
            status: "ok",
          },
        ],
      })
    );

    try {
      await expect(
        client.callTool({
          name: "fff_nope",
          arguments: { source: "codex" },
        })
      ).rejects.toThrow(/Unknown native FFF tool/);
      await expect(
        client.callTool({
          name: "fff_grep",
          arguments: { source: "claude", query: "auth" },
        })
      ).rejects.toThrow(/source/);
      expect(calls).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("starts with only diagnostics when no source is healthy", async () => {
    const client = await connectNativeClient(
      fakeRouter({
        tools: [SUPPORTED_FFF_GREP_TOOL],
        status: "missing",
      })
    );

    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        "fff_native_capabilities",
      ]);
      const capabilities = await client.callTool({
        name: "fff_native_capabilities",
        arguments: {},
      });
      expect(
        JSON.parse(textContent(capabilities as CallToolResult))
      ).toMatchObject({
        sourceCoverage: [
          {
            name: "codex",
            status: "missing",
            nativeCoverage: "root-wide",
            managedInclude: ["sessions/*.jsonl"],
          },
        ],
      });
    } finally {
      await client.close();
    }
  });
});

async function connectNativeClient(
  router: FffCapabilityRouter,
  budget?: NativeCallBudget
) {
  const { server } = await createNativeServer({ router, budget });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "native-server-test",
    version: "0.1.0",
  });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

function fakeRouter(input: {
  tools?: Tool[];
  toolsBySource?: Record<string, Tool[]>;
  calls?: Array<{ source: SourceName; tool: string; args: unknown }>;
  result?: CallToolResult;
  callHandler?: (
    source: SourceName,
    tool: string,
    args: Record<string, unknown> | undefined
  ) => Promise<any>;
  status?: "ok" | "missing" | "failed";
  sources?: ReturnType<FffCapabilityRouter["listSources"]>;
}): FffCapabilityRouter {
  const status = input.status ?? "ok";
  const sources =
    input.sources ??
    ([
      {
        name: "codex" as SourceName,
        root: "/tmp/codex",
        include: ["sessions/*.jsonl"],
        status,
        ...(status === "ok" ? {} : { warning: "missing root" }),
      },
    ] satisfies ReturnType<FffCapabilityRouter["listSources"]>);
  return {
    listSources: () => sources,
    getWarnings: () => [],
    listTools: async (source?: SourceName) =>
      source && input.toolsBySource
        ? (input.toolsBySource[source] ?? [])
        : (input.tools ?? []),
    call: async (
      source: SourceName,
      tool: string,
      args: Record<string, unknown> | undefined
    ) => {
      input.calls?.push({ source, tool, args });
      if (input.callHandler) {
        return input.callHandler(source, tool, args);
      }
      return {
        source,
        root: "/tmp/codex",
        tool,
        result: input.result ?? { content: [{ type: "text", text: "ok" }] },
      };
    },
  } as unknown as FffCapabilityRouter;
}

function textContent(result: CallToolResult) {
  const text = result.content.find((entry) => entry.type === "text");
  if (!text || !("text" in text)) {
    throw new Error("missing text content");
  }
  return text.text;
}
