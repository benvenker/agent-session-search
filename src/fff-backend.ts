import { isAbsolute, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { SearchResult, SearchWarning, SourceName } from "./types.js";

export type FffGrepInput = {
  query: string;
  maxResults?: number;
};

export type FffToolContent = {
  type: string;
  text?: string;
};

export type FffToolResult = {
  content?: FffToolContent[];
  isError?: boolean;
};

export type FffClient = {
  grep(input: FffGrepInput): Promise<FffToolResult>;
  close?(): Promise<void>;
};

export type McpToolClient = {
  callTool(input: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
};

export type OneRootFffBackendOptions = {
  source: SourceName;
  root: string;
  client: FffClient;
  timeoutMs?: number;
};

export type OneRootFffSearchInput = {
  patterns: string[];
  maxResults?: number;
};

export type OneRootFffSearchOutput = {
  warnings: SearchWarning[];
  results: SearchResult[];
};

export class OneRootFffBackend {
  constructor(private readonly options: OneRootFffBackendOptions) {}

  async close(): Promise<void> {
    await this.options.client.close?.();
  }

  async search(input: OneRootFffSearchInput): Promise<OneRootFffSearchOutput> {
    const results: SearchResult[] = [];
    const warnings: SearchWarning[] = [];

    for (const pattern of input.patterns) {
      if (hasReachedCap(results, input.maxResults)) {
        break;
      }

      let response: FffToolResult;
      try {
        response = await withTimeout(
          this.options.client.grep({
            query: pattern,
            maxResults: remainingResults(results, input.maxResults),
          }),
          this.options.timeoutMs,
          pattern,
        );
      } catch (error) {
        warnings.push(this.warning(errorCode(error), errorMessage(error)));
        continue;
      }

      if (response.isError) {
        warnings.push(this.warning("fff_backend_error", responseText(response) || "FFF backend reported an error."));
        continue;
      }

      results.push(...this.normalizeGrepResponse(pattern, response).slice(0, remainingResults(results, input.maxResults)));
    }

    return { warnings, results };
  }

  private warning(code: string, message: string): SearchWarning {
    return {
      source: this.options.source,
      root: this.options.root,
      code,
      message,
    };
  }

  private normalizeGrepResponse(pattern: string, response: FffToolResult): SearchResult[] {
    const text = responseText(response);

    if (!text) {
      return [];
    }

    const results: SearchResult[] = [];
    let currentPath: string | undefined;

    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("→ ")) {
        continue;
      }

      const match = /^ (\d+): (.*)$/.exec(line);
      if (!match) {
        currentPath = line;
        continue;
      }

      if (!currentPath) {
        continue;
      }

      results.push({
        source: this.options.source,
        root: this.options.root,
        path: normalizePath(this.options.root, currentPath),
        line: Number(match[1]),
        content: match[2],
        pattern,
      });
    }

    return results;
  }
}

export class FffMcpClient implements FffClient {
  constructor(private readonly client: McpToolClient) {}

  async grep(input: FffGrepInput): Promise<FffToolResult> {
    return (await this.client.callTool({
      name: "grep",
      arguments: {
        query: input.query,
        maxResults: input.maxResults,
      },
    })) as FffToolResult;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export type CreateFffMcpClientOptions = {
  command?: string;
  args?: string[];
};

export async function createFffMcpClient(root: string, options: CreateFffMcpClientOptions = {}): Promise<FffMcpClient> {
  const transport = new StdioClientTransport({
    command: options.command ?? "fff-mcp",
    args: [...(options.args ?? ["--no-update-check"]), root],
  });
  const client = new Client({ name: "agent-session-search", version: "0.1.0" });

  await client.connect(transport);

  return new FffMcpClient(client);
}

function normalizePath(root: string, path: string) {
  return isAbsolute(path) ? path : join(root, path);
}

function hasReachedCap(results: SearchResult[], maxResults: number | undefined) {
  return maxResults !== undefined && results.length >= maxResults;
}

function remainingResults(results: SearchResult[], maxResults: number | undefined) {
  return maxResults === undefined ? undefined : Math.max(maxResults - results.length, 0);
}

function responseText(response: FffToolResult) {
  return response.content
    ?.filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, pattern: string): Promise<T> {
  if (timeoutMs === undefined) {
    return promise;
  }

  let timeout: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new FffBackendTimeout(timeoutMs, pattern));
    }, timeoutMs);
    timeout.unref?.();
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

class FffBackendTimeout extends Error {
  readonly code = "fff_backend_timeout";

  constructor(timeoutMs: number, pattern: string) {
    super(`FFF backend timed out after ${timeoutMs}ms while searching for pattern: ${pattern}`);
  }
}

function errorCode(error: unknown) {
  if (error instanceof FffBackendTimeout) {
    return error.code;
  }
  return "fff_backend_error";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "FFF backend failed.";
}
