import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { FffClient } from "./fff-backend.js";
import type { ResolvedSessionSource } from "./roots.js";
import type { SearchWarning, SourceName } from "./types.js";

export type RouterSourceInfo = {
  name: SourceName;
  root: string;
  include?: string[];
  status: ResolvedSessionSource["status"];
  warning?: string;
};

export type RouterCallResult = {
  source: SourceName;
  root: string;
  tool: string;
  result: CallToolResult;
};

export type FffCapabilityRouterOptions = {
  sources: ResolvedSessionSource[];
  clientForRoot(root: string): Promise<FffClient>;
};

type ToolCacheEntry =
  | { state: "pending"; promise: Promise<Tool[]> }
  | { state: "fulfilled"; tools: Tool[] };

export class FffCapabilityRouter {
  private readonly sources: ResolvedSessionSource[];
  private readonly toolsByRoot = new Map<string, ToolCacheEntry>();
  private readonly discoveryWarnings: SearchWarning[] = [];

  constructor(private readonly options: FffCapabilityRouterOptions) {
    this.sources = options.sources.map(cloneSource);
  }

  listSources(): RouterSourceInfo[] {
    return this.sources.map((source) => ({
      name: source.name,
      root: source.root,
      ...(source.include ? { include: [...source.include] } : {}),
      status: source.status,
      ...(source.warning ? { warning: source.warning } : {}),
    }));
  }

  getWarnings(): SearchWarning[] {
    return this.discoveryWarnings.map((warning) => ({ ...warning }));
  }

  async listTools(source?: SourceName): Promise<Tool[]> {
    if (source !== undefined) {
      return this.listToolsForSource(this.requireHealthySource(source));
    }

    const errors: SearchWarning[] = [];
    for (const candidate of this.sources.filter(
      (entry) => entry.status === "ok"
    )) {
      try {
        return await this.listToolsForSource(candidate);
      } catch (error) {
        const warning = {
          source: candidate.name,
          root: candidate.root,
          code: "fff_tool_discovery_failed",
          message: `FFF tool discovery failed for source ${candidate.name}: ${errorMessage(error)}`,
        };
        errors.push(warning);
        this.discoveryWarnings.push(warning);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors[errors.length - 1]!.message);
    }
    throw new Error("No healthy session sources are available for FFF tools.");
  }

  async call(
    source: SourceName,
    tool: string,
    args: Record<string, unknown> = {}
  ): Promise<RouterCallResult> {
    const selected = this.requireHealthySource(source);
    const client = await this.options.clientForRoot(selected.root);
    if (!client.callTool) {
      throw new Error("FFF client does not support generic tool calls.");
    }
    const result = await client.callTool({ name: tool, arguments: args });
    return {
      source: selected.name,
      root: selected.root,
      tool,
      result,
    };
  }

  private async listToolsForSource(source: ResolvedSessionSource) {
    const existing = this.toolsByRoot.get(source.root);
    if (existing?.state === "fulfilled") {
      return cloneTools(existing.tools);
    }
    if (existing?.state === "pending") {
      return existing.promise.then(cloneTools);
    }

    const promise = this.options
      .clientForRoot(source.root)
      .then(async (client) => {
        if (!client.listTools) {
          return [];
        }
        const tools = cloneTools(await client.listTools());
        this.toolsByRoot.set(source.root, {
          state: "fulfilled",
          tools,
        });
        return cloneTools(tools);
      })
      .catch((error) => {
        this.toolsByRoot.delete(source.root);
        throw error;
      });
    this.toolsByRoot.set(source.root, { state: "pending", promise });
    return promise;
  }

  private requireHealthySource(sourceName: SourceName) {
    const selected = this.sources.find((source) => source.name === sourceName);
    if (!selected) {
      throw new Error(`Unknown session source: ${sourceName}`);
    }
    if (selected.status !== "ok") {
      throw new Error(
        `Session source ${sourceName} is not searchable: ${
          selected.warning ?? selected.status
        }`
      );
    }
    return selected;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cloneSource(source: ResolvedSessionSource): ResolvedSessionSource {
  return {
    ...source,
    ...(source.include ? { include: [...source.include] } : {}),
  };
}

function cloneTools(tools: Tool[]): Tool[] {
  return tools.map((tool) => cloneJson(tool));
}

function cloneJson<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
