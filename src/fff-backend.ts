import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  SearchBackendMetadata,
  SearchResult,
  SearchWarning,
  SourceName,
} from "./types.js";
import { trackChildProcessPid } from "./child-process-cleanup.js";
import { DetachedStdioClientTransport } from "./detached-stdio-transport.js";
import { ensureFffMcpCompatible } from "./fff-runtime.js";
import { pathMatchesInclude } from "./roots.js";

export type FffGrepInput = {
  query: string;
  maxResults?: number;
};

export type FffMultiGrepInput = {
  patterns: string[];
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
  multiGrep?(input: FffMultiGrepInput): Promise<FffToolResult>;
  listTools?(): Promise<string[]>;
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
  backend?: SearchBackendMetadata;
};

const DEFAULT_EMPTY_RESULT_RETRY_ATTEMPTS = 3;
const DEFAULT_EMPTY_RESULT_RETRY_DELAY_MS = 100;

export class OneRootFffBackend {
  private hasCompletedSearch = false;
  private multiGrepStatus:
    | { state: "unknown" }
    | { state: "unsupported"; reason: string }
    | { state: "supported" } = { state: "unknown" };

  constructor(private readonly options: OneRootFffBackendOptions) {}

  async close(): Promise<void> {
    await this.options.client.close?.();
  }

  async search(input: OneRootFffSearchInput): Promise<OneRootFffSearchOutput> {
    if (this.canAttemptMultiGrep(input)) {
      return this.searchWithGatedMultiGrep(input);
    }

    const fallbackReason =
      input.patterns.length > 1 && !this.options.client.multiGrep
        ? "multi_grep_unavailable"
        : undefined;
    const sequential = await this.searchSequential(input);
    return {
      ...sequential,
      backend: {
        mode: fallbackReason ? "sequential_grep_fallback" : "sequential_grep",
        ...(fallbackReason ? { fallbackReason } : {}),
      },
    };
  }

  private async searchSequential(
    input: OneRootFffSearchInput
  ): Promise<OneRootFffSearchOutput> {
    const results: SearchResult[] = [];
    const warnings: SearchWarning[] = [];
    const deferBackendCap = shouldDeferBackendCap(input);

    for (const pattern of input.patterns) {
      if (hasReachedCap(results, input.maxResults)) {
        break;
      }

      const output = await this.searchPattern(
        pattern,
        deferBackendCap
          ? undefined
          : remainingResults(results, input.maxResults)
      );
      warnings.push(...output.warnings);
      const filteredResults = output.results.filter((result) =>
        resultMatchesSearchInput(result, this.options.root, input)
      );
      mergeSearchResults(
        results,
        filteredResults.slice(0, remainingResults(results, input.maxResults))
      );
    }

    return { warnings, results };
  }

  private canAttemptMultiGrep(input: OneRootFffSearchInput) {
    return (
      input.patterns.length > 1 &&
      input.context === undefined &&
      this.options.client.multiGrep !== undefined
    );
  }

  private async searchWithGatedMultiGrep(
    input: OneRootFffSearchInput
  ): Promise<OneRootFffSearchOutput> {
    if (this.multiGrepStatus.state === "unsupported") {
      const sequential = await this.searchSequential(input);
      return {
        ...sequential,
        warnings: [
          ...sequential.warnings,
          this.multiGrepFallbackWarning(this.multiGrepStatus.reason),
        ],
        backend: {
          mode: "sequential_grep_fallback",
          fallbackReason: this.multiGrepStatus.reason,
        },
      };
    }

    if (this.multiGrepStatus.state === "supported") {
      const multi = await this.searchMultiGrep(input);
      if (multi.warnings.length === 0) {
        return {
          warnings: [],
          results: multi.results,
          backend: { mode: "multi_grep" },
        };
      }

      const reason = multi.warnings[0]?.code ?? "multi_grep_failed";
      this.multiGrepStatus = { state: "unsupported", reason };
      const sequential = await this.searchSequential(input);
      return {
        ...sequential,
        warnings: [
          ...sequential.warnings,
          ...multi.warnings,
          this.multiGrepFallbackWarning(reason),
        ],
        backend: {
          mode: "sequential_grep_fallback",
          fallbackReason: reason,
        },
      };
    }

    const sequential = await this.searchSequential(input);
    const multi = await this.searchMultiGrep(input);
    if (multi.warnings.length > 0) {
      const reason = multi.warnings[0]?.code ?? "multi_grep_failed";
      this.multiGrepStatus = { state: "unsupported", reason };
      return {
        ...sequential,
        warnings: [
          ...sequential.warnings,
          ...multi.warnings,
          this.multiGrepFallbackWarning(reason),
        ],
        backend: {
          mode: "sequential_grep_fallback",
          fallbackReason: reason,
        },
      };
    }

    if (
      this.multiGrepStatus.state === "unknown" &&
      !isRecallEquivalent(sequential.results, multi.results)
    ) {
      const reason = "multi_grep_recall_probe_failed";
      this.multiGrepStatus = { state: "unsupported", reason };
      return {
        ...sequential,
        warnings: [
          ...sequential.warnings,
          this.multiGrepFallbackWarning(reason),
        ],
        backend: {
          mode: "sequential_grep_fallback",
          fallbackReason: reason,
        },
      };
    }

    this.multiGrepStatus = { state: "supported" };
    return {
      warnings: sequential.warnings,
      results: multi.results,
      backend: { mode: "multi_grep" },
    };
  }

  private async searchMultiGrep(
    input: OneRootFffSearchInput
  ): Promise<OneRootFffSearchOutput> {
    try {
      if (this.multiGrepStatus.state === "unknown") {
        const tools = await this.options.client.listTools?.();
        if (tools && !tools.includes("multi_grep")) {
          return {
            warnings: [
              this.warning(
                "multi_grep_unavailable",
                "FFF backend does not advertise multi_grep."
              ),
            ],
            results: [],
          };
        }
      }

      const response = await withTimeout(
        this.options.client.multiGrep!({
          patterns: input.patterns,
          maxResults: input.maxResults,
        }),
        this.options.timeoutMs,
        input.patterns.join(" OR ")
      );

      if (response.isError) {
        return {
          warnings: [
            this.warning(
              "multi_grep_backend_error",
              responseText(response) || "FFF multi_grep reported an error."
            ),
          ],
          results: [],
        };
      }

      return {
        warnings: [],
        results: this.normalizeMultiGrepResponse(input.patterns, response)
          .filter((result) =>
            resultMatchesSearchInput(result, this.options.root, input)
          )
          .slice(0, input.maxResults),
      };
    } catch (error) {
      return {
        warnings: [
          this.warning(
            errorCode(error) === "fff_backend_timeout"
              ? "multi_grep_backend_timeout"
              : "multi_grep_backend_error",
            errorMessage(error)
          ),
        ],
        results: [],
      };
    }
  }

  private async searchPattern(
    pattern: string,
    maxResults: number | undefined
  ): Promise<OneRootFffSearchOutput> {
    // fff-mcp can briefly return empty results while its first index warms up.
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

  private normalizeMultiGrepResponse(
    patterns: string[],
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

      const matchedPatterns = patterns.filter((pattern) =>
        match[2].includes(pattern)
      );
      if (matchedPatterns.length === 0) {
        continue;
      }

      results.push({
        source: this.options.source,
        root: this.options.root,
        path: normalizePath(this.options.root, currentPath),
        line: Number(match[1]),
        content: match[2],
        pattern: matchedPatterns[0],
        patterns: matchedPatterns,
      });
    }

    return results;
  }

  private multiGrepFallbackWarning(reason: string): SearchWarning {
    return {
      ...this.warning(
        "multi_grep_fallback",
        `Using sequential grep because FFF multi_grep was not promoted: ${reason}.`
      ),
      recommendedAction:
        "Sequential grep is authoritative and safe. Upgrade or configure fff-mcp only if you need multi_grep performance diagnostics.",
    };
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

function mergeSearchResults(target: SearchResult[], incoming: SearchResult[]) {
  const byLine = new Map(
    target.map((result) => [searchResultKey(result), result])
  );
  for (const result of incoming) {
    const existing = byLine.get(searchResultKey(result));
    if (!existing) {
      target.push(result);
      byLine.set(searchResultKey(result), result);
      continue;
    }
    for (const pattern of result.patterns ??
      [result.pattern].filter(isString)) {
      addUniquePattern(existing, pattern);
    }
  }
}

function isRecallEquivalent(sequential: SearchResult[], multi: SearchResult[]) {
  const multiKeys = new Set(multi.map(searchResultKey));
  return sequential.every((result) => multiKeys.has(searchResultKey(result)));
}

function searchResultKey(result: SearchResult) {
  return [
    result.source,
    result.root,
    result.path,
    result.line ?? "",
    result.content,
  ].join("\0");
}

function addUniquePattern(result: SearchResult, pattern: string) {
  const patterns = result.patterns ?? (result.pattern ? [result.pattern] : []);
  if (!patterns.includes(pattern)) {
    patterns.push(pattern);
  }
  result.patterns = patterns;
  result.pattern = patterns[0];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export class FffMcpClient implements FffClient {
  constructor(
    private readonly client: McpToolClient,
    private readonly cleanupDir?: string,
    private readonly untrackChildProcess?: () => void
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

  async multiGrep(input: FffMultiGrepInput): Promise<FffToolResult> {
    return (await this.client.callTool({
      name: "multi_grep",
      arguments: {
        patterns: input.patterns,
        maxResults: input.maxResults,
      },
    })) as FffToolResult;
  }

  async listTools(): Promise<string[]> {
    const listTools = (
      this.client as McpToolClient & {
        listTools?: () => Promise<{ tools?: Array<{ name?: string }> }>;
      }
    ).listTools;
    if (!listTools) {
      return [];
    }
    const result = await listTools.call(this.client);
    return (
      result.tools
        ?.map((tool) => tool.name)
        .filter((name): name is string => typeof name === "string") ?? []
    );
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } finally {
      this.untrackChildProcess?.();
      if (this.cleanupDir) {
        await rm(this.cleanupDir, { recursive: true, force: true });
      }
    }
  }
}

export type CreateFffMcpClientOptions = {
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
};

export async function createFffMcpClient(
  root: string,
  options: CreateFffMcpClientOptions = {}
): Promise<FffMcpClient> {
  await ensureFffMcpCompatible(options.command ?? "fff-mcp", options.env);
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
  const transport = new DetachedStdioClientTransport({
    command: options.command ?? "fff-mcp",
    args: [...args, root],
    env: options.env ? stringEnv(options.env) : undefined,
  });
  const client = new Client({ name: "agent-session-search", version: "0.1.0" });

  let untrackChildProcess: (() => void) | undefined;
  transport.onclose = () => {
    untrackChildProcess?.();
    untrackChildProcess = undefined;
  };

  try {
    await client.connect(transport);
    const pid = transport.pid;
    if (pid !== null) {
      untrackChildProcess = trackChildProcessPid(pid, {
        processGroup: process.platform !== "win32",
      });
    }
  } catch (error) {
    if (defaultDbDir) {
      await rm(defaultDbDir, { recursive: true, force: true });
    }
    throw error;
  }

  return new FffMcpClient(client, defaultDbDir, untrackChildProcess);
}

function normalizePath(root: string, path: string) {
  return isAbsolute(path) ? path : join(root, path);
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
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

function shouldDeferBackendCap(input: OneRootFffSearchInput) {
  return Boolean(input.paths?.length || hasRestrictiveInclude(input.include));
}

function hasRestrictiveInclude(include: string[] | undefined) {
  return Boolean(include?.length && !include.includes("*"));
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
