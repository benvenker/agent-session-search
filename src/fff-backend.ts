import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { SearchResult, SearchWarning, SourceName } from "./types.js";
import { pathMatchesInclude } from "./roots.js";

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
  callTool(input: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown>;
  close(): Promise<void>;
};

export type OneRootFffBackendOptions = {
  source: SourceName;
  root: string;
  client: FffClient;
  timeoutMs?: number;
  emptyResultRetryAttempts?: number;
  emptyResultRetryDelayMs?: number;
};

export type OneRootFffSearchInput = {
  patterns: string[];
  maxResults?: number;
  context?: number;
  paths?: string[];
  include?: string[];
};

export type OneRootFffSearchOutput = {
  warnings: SearchWarning[];
  results: SearchResult[];
};

const DEFAULT_EMPTY_RESULT_RETRY_ATTEMPTS = 3;
const DEFAULT_EMPTY_RESULT_RETRY_DELAY_MS = 100;

export class OneRootFffBackend {
  private hasCompletedSearch = false;

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

      const output = await this.searchPattern(
        pattern,
        input.paths?.length
          ? undefined
          : remainingResults(results, input.maxResults)
      );
      warnings.push(...output.warnings);
      const filteredResults = output.results.filter((result) =>
        resultMatchesSearchInput(result, this.options.root, input)
      );
      results.push(
        ...filteredResults.slice(0, remainingResults(results, input.maxResults))
      );
    }

    return { warnings, results };
  }

  private async searchPattern(
    pattern: string,
    maxResults: number | undefined
  ): Promise<OneRootFffSearchOutput> {
    const attempts = this.hasCompletedSearch
      ? 0
      : (this.options.emptyResultRetryAttempts ??
        DEFAULT_EMPTY_RESULT_RETRY_ATTEMPTS);

    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      let response: FffToolResult;
      try {
        response = await withTimeout(
          this.options.client.grep({
            query: pattern,
            maxResults,
          }),
          this.options.timeoutMs,
          pattern
        );
      } catch (error) {
        return {
          warnings: [this.warning(errorCode(error), errorMessage(error))],
          results: [],
        };
      }

      if (response.isError) {
        return {
          warnings: [
            this.warning(
              "fff_backend_error",
              responseText(response) || "FFF backend reported an error."
            ),
          ],
          results: [],
        };
      }

      const results = this.normalizeGrepResponse(pattern, response);
      if (results.length > 0 || attempt === attempts) {
        this.hasCompletedSearch = true;
        return { warnings: [], results };
      }
      await delay(
        this.options.emptyResultRetryDelayMs ??
          DEFAULT_EMPTY_RESULT_RETRY_DELAY_MS
      );
    }

    return { warnings: [], results: [] };
  }

  private warning(code: string, message: string): SearchWarning {
    return {
      source: this.options.source,
      root: this.options.root,
      code,
      message,
    };
  }

  private normalizeGrepResponse(
    pattern: string,
    response: FffToolResult
  ): SearchResult[] {
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

function resultMatchesSearchInput(
  result: SearchResult,
  root: string,
  input: OneRootFffSearchInput
) {
  if (!pathMatchesInclude(root, result.path, input.include)) {
    return false;
  }
  if (input.paths?.length && !input.paths.includes(result.path)) {
    return false;
  }
  return true;
}

export class FffMcpClient implements FffClient {
  constructor(
    private readonly client: McpToolClient,
    private readonly cleanupDir?: string
  ) {}

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
    try {
      await this.client.close();
    } finally {
      if (this.cleanupDir) {
        await rm(this.cleanupDir, { recursive: true, force: true });
      }
    }
  }
}

export type CreateFffMcpClientOptions = {
  command?: string;
  args?: string[];
};

export async function createFffMcpClient(
  root: string,
  options: CreateFffMcpClientOptions = {}
): Promise<FffMcpClient> {
  const defaultDbDir = options.args
    ? undefined
    : await mkdtemp(join(tmpdir(), "agent-session-search-fff-"));
  const args = options.args ?? [
    "--no-update-check",
    "--frecency-db",
    join(defaultDbDir!, "frecency.mdb"),
    "--history-db",
    join(defaultDbDir!, "history.mdb"),
  ];
  const transport = new StdioClientTransport({
    command: options.command ?? "fff-mcp",
    args: [...args, root],
  });
  const client = new Client({ name: "agent-session-search", version: "0.1.0" });

  try {
    await client.connect(transport);
  } catch (error) {
    if (defaultDbDir) {
      await rm(defaultDbDir, { recursive: true, force: true });
    }
    throw error;
  }

  return new FffMcpClient(client, defaultDbDir);
}

function normalizePath(root: string, path: string) {
  return isAbsolute(path) ? path : join(root, path);
}

function hasReachedCap(
  results: SearchResult[],
  maxResults: number | undefined
) {
  return maxResults !== undefined && results.length >= maxResults;
}

function remainingResults(
  results: SearchResult[],
  maxResults: number | undefined
) {
  return maxResults === undefined
    ? undefined
    : Math.max(maxResults - results.length, 0);
}

function responseText(response: FffToolResult) {
  return response.content
    ?.filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n");
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  pattern: string
): Promise<T> {
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

  return Promise.race([promise, timeoutPromise]).finally(() =>
    clearTimeout(timeout)
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FffBackendTimeout extends Error {
  readonly code = "fff_backend_timeout";

  constructor(timeoutMs: number, pattern: string) {
    super(
      `FFF backend timed out after ${timeoutMs}ms while searching for pattern: ${pattern}`
    );
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
