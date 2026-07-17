#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createFffBackendPool, type FffBackendPool } from "./client-pool.js";
import { isEntrypoint } from "./entrypoint.js";
import { searchOptionsFromEnv } from "./env.js";
import type {
  FffCapabilityRouter,
  RouterSourceInfo,
} from "./fff-capability-router.js";
import {
  FFF_NATIVE_DEFAULT_MAX_RESULTS,
  FFF_NATIVE_MAX_CONCURRENT_CALLS,
  FFF_NATIVE_MAX_RESULT_BYTES,
  FFF_NATIVE_MAX_RESULTS,
  FFF_NATIVE_MAX_ATTEMPTED_CALLS,
  FFF_NATIVE_POLICY_VERSION,
  NativeCallBudget,
  classifyNativeCatalog,
  nativeErrorResult,
  type NativeCatalogDecision,
} from "./fff-native-policy.js";
import {
  ensureFffMcpCompatible,
  FffMcpCompatibilityError,
  RECOMMENDED_FFF_MCP_RELEASE,
  REQUIRED_FFF_MCP_RELEASE,
} from "./fff-runtime.js";
import { packageVersion } from "./package-info.js";
import { resolveSessionRoots, type ResolvedSessionSource } from "./roots.js";
import { installProcessCleanupHandlers } from "./server-lifecycle.js";

export const FFF_NATIVE_CAPABILITIES_TOOL = "fff_native_capabilities";

export type NativeServerCatalog = {
  sources: RouterSourceInfo[];
  decisions: NativeCatalogDecision[];
  warnings: Array<{
    source?: string;
    root?: string;
    code: string;
    message: string;
  }>;
  tools: Tool[];
  approved: Map<string, Extract<NativeCatalogDecision, { status: "approved" }>>;
};

export type CreateNativeServerOptions = {
  router: FffCapabilityRouter;
  budget?: NativeCallBudget;
};

export async function createNativeServer(options: CreateNativeServerOptions) {
  const budget = options.budget ?? new NativeCallBudget();
  const catalog = await buildNativeCatalog(options.router);
  const server = new Server(
    {
      name: "agent-session-search-native",
      version: packageVersion(),
    },
    {
      capabilities: { tools: {} },
      instructions:
        "Opt-in raw FFF lane. Use fff_native_capabilities first; mirrored tools are source-bound and root-wide.",
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: catalog.tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};

    if (name === FFF_NATIVE_CAPABILITIES_TOOL) {
      return capabilitiesResult(catalog, budget);
    }

    const decision = catalog.approved.get(name);
    if (!decision) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown native FFF tool: ${name}`
      );
    }

    const validated = decision.validator(args);
    if (!validated.valid) {
      throw new McpError(ErrorCode.InvalidParams, validated.error);
    }

    const sourceAllowed = decision.sourceDecisions?.some(
      (sourceDecision) =>
        sourceDecision.source === validated.data.source &&
        sourceDecision.status === "approved"
    );
    if (!sourceAllowed) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Source is not approved for ${name}: ${validated.data.source}`
      );
    }

    return budget.run(() =>
      options.router.call(
        validated.data.source,
        decision.upstreamName,
        validated.data.upstreamArgs
      )
    );
  });

  return { server, catalog, budget };
}

export async function main() {
  const options = searchOptionsFromEnv();
  await ensureFffMcpCompatible(options.fffMcp?.command);
  const resolved = await resolveSessionRoots({
    configPath: options.configPath,
  });
  const pool = createFffBackendPool({
    fffMcp: options.fffMcp,
    timeoutMs: options.fffTimeoutMs,
  });
  installProcessCleanupHandlers(() => pool.close());
  const router = pool.createRouter(resolved.sources);
  const { server } = await createNativeServer({ router });
  await server.connect(new StdioServerTransport());
}

export async function createNativeServerForSources(input: {
  sources: ResolvedSessionSource[];
  pool?: FffBackendPool;
}) {
  const pool = input.pool ?? createFffBackendPool();
  const router = pool.createRouter(input.sources);
  return createNativeServer({ router });
}

async function buildNativeCatalog(
  router: FffCapabilityRouter
): Promise<NativeServerCatalog> {
  const sources = router.listSources();
  const healthySources = sources.filter((source) => source.status === "ok");
  const warnings = router.getWarnings();
  const catalogs = await Promise.all(
    healthySources.map(async (source) => {
      try {
        return {
          source: source.name,
          tools: await router.listTools(source.name),
        };
      } catch (error) {
        warnings.push({
          source: source.name,
          root: source.root,
          code: "fff_native_discovery_failed",
          message: `Native FFF tool discovery failed for source ${source.name}: ${errorMessage(error)}`,
        });
        return { source: source.name, tools: [] };
      }
    })
  );
  const decisions = classifyNativeCatalog({ catalogs });
  const approved = new Map<
    string,
    Extract<NativeCatalogDecision, { status: "approved" }>
  >();
  const mirroredTools: Tool[] = [];

  for (const decision of decisions) {
    if (decision.status !== "approved") {
      continue;
    }
    approved.set(decision.projectedName, decision);
    mirroredTools.push({
      ...decision.tool,
      description: [
        decision.tool.description ?? `Native FFF ${decision.upstreamName}.`,
        "Raw FFF presentation text is returned; no managed ranking, truncation, include filtering, or canonical-path rewriting is applied.",
        "The required source selects one configured root, and native coverage is root-wide.",
      ].join(" "),
    });
  }

  return {
    sources,
    decisions,
    warnings,
    approved,
    tools: [capabilitiesTool(), ...mirroredTools],
  };
}

function capabilitiesTool(): Tool {
  return {
    name: FFF_NATIVE_CAPABILITIES_TOOL,
    description:
      "Report native FFF exposure policy, source health, root-wide coverage, blocked tools, and remaining process-local budgets.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "FffNativeCapabilitiesParams",
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  };
}

function capabilitiesResult(
  catalog: NativeServerCatalog,
  budget: NativeCallBudget
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(nativeCapabilities(catalog, budget), null, 2),
      },
    ],
  };
}

function nativeCapabilities(
  catalog: NativeServerCatalog,
  budget: NativeCallBudget
) {
  return {
    lane: "native-fff",
    entrypoint: "agent-session-search-native-mcp",
    policyVersion: FFF_NATIVE_POLICY_VERSION,
    supportedFff: {
      requiredRelease: REQUIRED_FFF_MCP_RELEASE,
      recommendedRelease: RECOMMENDED_FFF_MCP_RELEASE,
    },
    budgets: {
      attemptedCallsRemaining: budget.remainingAttempts,
      activeCalls: budget.active,
      maxAttemptedCalls: FFF_NATIVE_MAX_ATTEMPTED_CALLS,
      maxConcurrentCalls: FFF_NATIVE_MAX_CONCURRENT_CALLS,
      defaultMaxResults: FFF_NATIVE_DEFAULT_MAX_RESULTS,
      maxResultsCeiling: FFF_NATIVE_MAX_RESULTS,
      maxSerializedResultBytes: FFF_NATIVE_MAX_RESULT_BYTES,
    },
    coverage: "root-wide",
    sourceCoverage: catalog.sources.map((source) => ({
      name: source.name,
      root: source.root,
      status: source.status,
      nativeCoverage: "root-wide",
      managedInclude: source.include ?? null,
      warning: source.warning,
    })),
    tools: {
      approved: Array.from(catalog.approved.values()).map((decision) => ({
        name: decision.projectedName,
        upstreamName: decision.upstreamName,
        sources:
          decision.sourceDecisions
            ?.filter((sourceDecision) => sourceDecision.status === "approved")
            .map((sourceDecision) => sourceDecision.source) ?? [],
      })),
      blocked: catalog.decisions
        .filter((decision) => decision.status === "blocked")
        .map((decision) => ({
          upstreamName: decision.tool.name,
          reason: decision.reason,
          sourceDecisions: decision.sourceDecisions,
        })),
    },
    warnings: catalog.warnings,
    notes: [
      "Native calls inspect the selected canonical root, not the managed lane include patterns.",
      "Config and schema changes require restarting this MCP server.",
      "Code Mode and an importable SDK are deferred; this binary is the opt-in raw FFF lane.",
    ],
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    if (error instanceof FffMcpCompatibilityError) {
      console.error(error.message);
      process.exitCode = 3;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  });
}
