import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FFF_NATIVE_POLICY,
  NativeCallBudget,
  SUPPORTED_FFF_GREP_TOOL,
  SUPPORTED_FFF_MULTI_GREP_TOOL,
  addNativeMetadata,
  assertAllToolsClassified,
  classifyNativeCatalog,
  classifyNativeTool,
  fingerprintTool,
  projectNativeToolSchema,
  type NativePolicyEntry,
} from "../src/fff-native-policy.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { RouterCallResult } from "../src/fff-capability-router.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fff-supported-tools-list.json"
);

describe("fff native policy", () => {
  it("matches the checked-in supported FFF tools catalog", async () => {
    const tools = JSON.parse(await readFile(fixturePath, "utf8")) as Tool[];
    const decisions = tools.map((tool) =>
      classifyNativeTool({
        tool,
        sourceNames: ["codex"],
      })
    );

    expect(
      decisions.map((decision) => [decision.tool.name, decision.status])
    ).toEqual([
      ["find_files", "blocked"],
      ["fff_grep", "approved"],
      ["fff_multi_grep", "approved"],
    ]);
    expect(decisions[0]).toMatchObject({
      status: "blocked",
      reason: "policy_not_exposable",
      entry: { classifications: ["internal"] },
    });
    expect(DEFAULT_FFF_NATIVE_POLICY.map((entry) => entry.name)).toEqual([
      "find_files",
      "grep",
      "multi_grep",
    ]);
  });

  it("approves exact audited definitions and projects required source schemas", () => {
    const grep = SUPPORTED_FFF_GREP_TOOL;
    const decision = classifyNativeTool({
      tool: grep,
      sourceNames: ["codex", "claude"],
    });

    expect(decision.status).toBe("approved");
    if (decision.status !== "approved") {
      return;
    }
    expect(decision.tool.name).toBe("fff_grep");
    expect(decision.tool.inputSchema.required).toContain("source");
    expect(decision.tool.inputSchema.properties?.source).toEqual({
      type: "string",
      enum: ["codex", "claude"],
      description: "Configured Agent Session Search source name.",
    });
    expect(decision.validator({ source: "codex", query: "auth" })).toEqual({
      valid: true,
      data: {
        source: "codex",
        upstreamArgs: { query: "auth", maxResults: 50 },
      },
    });
  });

  it("approves multi_grep with the default policy", () => {
    expect(
      classifyNativeTool({
        tool: SUPPORTED_FFF_MULTI_GREP_TOOL,
        sourceNames: ["codex"],
      })
    ).toMatchObject({ status: "approved", projectedName: "fff_multi_grep" });
  });

  it("blocks unknown, drifted, reserved, source-colliding, and non-object tools", () => {
    const grep = SUPPORTED_FFF_GREP_TOOL;
    const policy = policyFor(grep);

    expect(
      classifyNativeTool({
        tool: { ...grep, description: "Changed" },
        sourceNames: ["codex"],
        policy,
      })
    ).toMatchObject({ status: "blocked", reason: "definition_drift" });
    expect(
      classifyNativeTool({
        tool: { name: "cat", inputSchema: { type: "object" } },
        sourceNames: ["codex"],
        policy,
      })
    ).toMatchObject({ status: "blocked", reason: "unknown_tool" });
    expect(
      classifyNativeTool({
        tool: {
          name: "fff_native_capabilities",
          inputSchema: { type: "object" },
        },
        sourceNames: ["codex"],
        policy,
      })
    ).toMatchObject({ status: "blocked", reason: "reserved_name" });
    expect(
      classifyNativeTool({
        tool: {
          name: "grep",
          inputSchema: {
            type: "object",
            properties: { source: { type: "string" } },
          },
        },
        sourceNames: ["codex"],
        policy,
      })
    ).toMatchObject({ status: "blocked", reason: "source_collision" });
    expect(
      projectNativeToolSchema({
        tool: true as unknown as Tool,
        sourceNames: [],
      })
    ).toBeUndefined();
  });

  it("preserves denied, unknown, and internal-only policy identities", () => {
    const denied = policyEntryFor(SUPPORTED_FFF_GREP_TOOL, ["denied"]);
    const unknown = policyEntryFor(SUPPORTED_FFF_GREP_TOOL, ["unknown"]);
    const internal = policyEntryFor(SUPPORTED_FFF_GREP_TOOL, ["internal"]);

    expect(
      classifyNativeTool({
        tool: SUPPORTED_FFF_GREP_TOOL,
        sourceNames: ["codex"],
        policy: [denied],
      })
    ).toMatchObject({
      status: "blocked",
      reason: "policy_denied",
      entry: { classifications: ["denied"] },
    });
    expect(
      classifyNativeTool({
        tool: SUPPORTED_FFF_GREP_TOOL,
        sourceNames: ["codex"],
        policy: [unknown],
      })
    ).toMatchObject({
      status: "blocked",
      reason: "policy_unknown",
      entry: { classifications: ["unknown"] },
    });
    expect(
      classifyNativeTool({
        tool: SUPPORTED_FFF_GREP_TOOL,
        sourceNames: ["codex"],
        policy: [internal],
      })
    ).toMatchObject({
      status: "blocked",
      reason: "policy_not_exposable",
      entry: { classifications: ["internal"] },
    });
  });

  it("keeps object key ordering stable but treats array reordering as drift", () => {
    const one = auditedGrep();
    const reorderedKeys: Tool = {
      inputSchema: {
        required: ["query", "maxResults"],
        properties: {
          maxResults: { type: "number" },
          query: { type: "string" },
        },
        type: "object",
      },
      annotations: { readOnlyHint: true },
      description: "Search files",
      name: "grep",
    };
    const reorderedArray: Tool = {
      ...one,
      inputSchema: { ...one.inputSchema, required: ["maxResults", "query"] },
    };

    expect(fingerprintTool(reorderedKeys)).toBe(fingerprintTool(one));
    expect(fingerprintTool(reorderedArray)).not.toBe(fingerprintTool(one));
  });

  it("validates inputs before routing", () => {
    const grep = SUPPORTED_FFF_GREP_TOOL;
    const decision = classifyNativeTool({
      tool: grep,
      sourceNames: ["codex"],
    });
    expect(decision.status).toBe("approved");
    if (decision.status !== "approved") {
      return;
    }

    expect(decision.validator({ query: "auth" })).toMatchObject({
      valid: false,
    });
    expect(
      decision.validator({ source: "unknown", query: "auth" })
    ).toMatchObject({ valid: false });
    expect(
      decision.validator({ source: "codex", query: "auth", maxResults: 201 })
    ).toMatchObject({ valid: false });
    expect(
      decision.validator({ source: "codex", query: "auth", extra: true })
    ).toMatchObject({
      valid: false,
      error: "Unknown argument(s): extra",
    });
    expect(
      decision.validator({ source: "codex", query: "auth", maxResults: null })
    ).toEqual({
      valid: true,
      data: {
        source: "codex",
        upstreamArgs: { query: "auth", maxResults: null },
      },
    });
  });

  it("rejects projected-name collisions with reserved native diagnostics", () => {
    expect(
      classifyNativeTool({
        tool: { name: "native_capabilities", inputSchema: { type: "object" } },
        sourceNames: ["codex"],
      })
    ).toMatchObject({ status: "blocked", reason: "reserved_name" });
  });

  it("blocks a native catalog when any advertised source has schema drift", () => {
    const [decision] = classifyNativeCatalog({
      catalogs: [
        { source: "codex", tools: [SUPPORTED_FFF_GREP_TOOL] },
        {
          source: "claude",
          tools: [{ ...SUPPORTED_FFF_GREP_TOOL, description: "Changed" }],
        },
      ],
    });

    expect(decision).toMatchObject({
      status: "blocked",
      reason: "definition_drift",
      sourceDecisions: [
        {
          source: "claude",
          status: "blocked",
          reason: "definition_drift",
        },
        { source: "codex", status: "approved" },
      ],
    });
  });

  it("classifies tools discovered only on a non-first source without source-order dependence", () => {
    const catalog = classifyNativeCatalog({
      catalogs: [
        { source: "codex", tools: [SUPPORTED_FFF_GREP_TOOL] },
        { source: "claude", tools: [SUPPORTED_FFF_MULTI_GREP_TOOL] },
      ],
    });
    const reversedCatalog = classifyNativeCatalog({
      catalogs: [
        { source: "claude", tools: [SUPPORTED_FFF_MULTI_GREP_TOOL] },
        { source: "codex", tools: [SUPPORTED_FFF_GREP_TOOL] },
      ],
    });

    expect(catalog.map((decision) => decision.tool.name)).toEqual([
      "fff_grep",
      "fff_multi_grep",
    ]);
    expect(catalog.map(catalogSummary)).toEqual(
      reversedCatalog.map(catalogSummary)
    );
    expect(catalog).toMatchObject([
      {
        status: "approved",
        projectedName: "fff_grep",
        tool: {
          inputSchema: {
            properties: {
              source: { enum: ["codex"] },
            },
          },
        },
        sourceDecisions: [
          { source: "claude", status: "missing", reason: "missing_tool" },
          { source: "codex", status: "approved" },
        ],
      },
      {
        status: "approved",
        projectedName: "fff_multi_grep",
        tool: {
          inputSchema: {
            properties: {
              source: { enum: ["claude"] },
            },
          },
        },
        sourceDecisions: [
          { source: "claude", status: "approved" },
          { source: "codex", status: "missing", reason: "missing_tool" },
        ],
      },
    ]);
  });

  it("fails the upgrade tripwire for unclassified discovered tools", () => {
    expect(() =>
      assertAllToolsClassified({
        tools: [
          SUPPORTED_FFF_GREP_TOOL,
          { name: "cat", inputSchema: { type: "object" } },
        ],
        policy: policyFor(SUPPORTED_FFF_GREP_TOOL),
      })
    ).toThrow("Unclassified FFF tools");
  });

  it("enforces attempt budget, metadata, and result size", async () => {
    const budget = new NativeCallBudget({
      maxAttempts: 2,
      timeoutMs: 5,
      maxResultBytes: 500,
    });

    const first = await budget.run(async () => ({
      source: "codex",
      root: "/tmp/codex",
      tool: "grep",
      result: { content: [{ type: "text", text: "ok" }] },
    }));
    expect(first._meta).toMatchObject({
      "dev.benvenker.agent-session-search/native": {
        source: "codex",
        root: "/tmp/codex",
        tool: "grep",
      },
    });

    await expect(
      budget.run(async () => ({
        source: "codex",
        root: "/tmp/codex",
        tool: "grep",
        result: { content: [{ type: "text", text: "ok" }] },
      }))
    ).resolves.toMatchObject({ content: [{ text: "ok" }] });
    await expect(
      budget.run(async () => ({
        source: "codex",
        root: "/tmp/codex",
        tool: "grep",
        result: { content: [] },
      }))
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: "native_call_budget_exhausted" }],
    });
  });

  it("keeps timed-out operations in the concurrency budget until upstream settles", async () => {
    const budget = new NativeCallBudget({
      maxAttempts: 10,
      maxConcurrent: 4,
      timeoutMs: 1,
    });

    const never = () => new Promise<RouterCallResult>(() => {});
    const timedOut = await Promise.all([
      budget.run(never),
      budget.run(never),
      budget.run(never),
      budget.run(never),
    ]);
    expect(timedOut.map(errorText)).toEqual([
      "native_call_timeout",
      "native_call_timeout",
      "native_call_timeout",
      "native_call_timeout",
    ]);
    expect(budget.active).toBe(4);
    await expect(
      budget.run(async () => ({
        source: "codex",
        root: "/tmp/codex",
        tool: "grep",
        result: { content: [] },
      }))
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: "native_call_concurrency_exhausted" }],
    });
  });

  it("reports timeout and non-timeout router failures with distinct codes", async () => {
    const timeoutBudget = new NativeCallBudget({ timeoutMs: 1 });
    await expect(
      timeoutBudget.run(() => new Promise<RouterCallResult>(() => {}))
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: "native_call_timeout" }],
    });

    const upstreamBudget = new NativeCallBudget();
    await expect(
      upstreamBudget.run(async () => {
        throw new Error("x".repeat(2_000));
      })
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: `native_upstream_error: ${"x".repeat(1_024)}...` }],
    });
  });

  it("rejects metadata collisions and oversized results", () => {
    expect(() =>
      addNativeMetadata({
        source: "codex",
        root: "/tmp/codex",
        tool: "grep",
        result: {
          content: [],
          _meta: {
            "dev.benvenker.agent-session-search/native": {},
          },
        },
      })
    ).toThrow("native_result_metadata_collision");
    expect(() =>
      addNativeMetadata(
        {
          source: "codex",
          root: "/tmp/codex",
          tool: "grep",
          result: { content: [{ type: "text", text: "x".repeat(100) }] },
        },
        10
      )
    ).toThrow("native_result_too_large");
  });
});

function auditedGrep(): Tool {
  return {
    name: "grep",
    description: "Search files",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" },
      },
      required: ["query", "maxResults"],
    },
    annotations: { readOnlyHint: true },
  };
}

function policyFor(tool: Tool): NativePolicyEntry[] {
  return [policyEntryFor(tool, ["internal", "exposable"])];
}

function policyEntryFor(
  tool: Tool,
  classifications: NativePolicyEntry["classifications"]
): NativePolicyEntry {
  return {
    name: tool.name,
    fingerprint: fingerprintTool(tool),
    classifications,
    maxResultsDefault: 50,
    maxResultsCeiling: 200,
  };
}

function errorText(result: { content?: unknown[] }) {
  const first = result.content?.[0] as { text?: string } | undefined;
  return first?.text;
}

function catalogSummary(
  decision: ReturnType<typeof classifyNativeCatalog>[number]
) {
  return {
    status: decision.status,
    tool: decision.tool.name,
    sourceEnum:
      decision.tool.inputSchema.properties?.source &&
      "enum" in decision.tool.inputSchema.properties.source
        ? decision.tool.inputSchema.properties.source.enum
        : undefined,
    sourceDecisions: decision.sourceDecisions,
  };
}
