import type {
  SearchCandidate,
  SearchResult,
  SearchSessionsInput,
  SearchSessionsOutput,
  SessionSearch,
} from "./types.js";
import {
  createFffMcpClient,
  OneRootFffBackend,
  type CreateFffMcpClientOptions,
  type OneRootFffSearchOutput,
} from "./fff-backend.js";
import {
  loadSearchConfig,
  pathMatchesInclude,
  resolveSessionRoots,
  type ConfigFile,
  type ResolvedSessionSource,
  type ResolveSessionRootsInput,
  type SearchDefaultsConfig,
  type SessionRootConfig,
} from "./roots.js";
import { rewriteQueryPatterns } from "./query-rewriter.js";
import { basename } from "node:path";

export type SessionSearchBackendInput = {
  patterns: string[];
  maxResults?: number;
  context?: number;
  paths?: string[];
  include?: string[];
};

export type SessionSearchBackend = {
  search(input: SessionSearchBackendInput): Promise<OneRootFffSearchOutput>;
  close?(): Promise<void>;
};

export type CreateSessionSearchBackend = (
  source: ResolvedSessionSource
) => SessionSearchBackend | Promise<SessionSearchBackend>;

export class CoordinatedSessionSearch implements SessionSearch {
  constructor(private readonly options: CreateSessionSearchOptions = {}) {}

  async searchSessions(
    input: SearchSessionsInput
  ): Promise<SearchSessionsOutput> {
    const searchConfig = await loadSearchConfig(this.options.configPath);
    const resolvedRoots = await resolveSessionRoots({
      sources: input.sources,
      configPath: this.options.configPath,
      config: searchConfig,
      defaultRoots: this.options.defaultRoots,
    });
    const defaults = validatedDefaults(searchConfig.defaults);
    const maxPatterns = input.maxPatterns ?? defaults.maxPatterns;
    const maxResultsPerSource =
      input.maxResultsPerSource ?? defaults.maxResultsPerSource;
    const context = input.context ?? defaults.context;
    const patternPlans = expandPatternPlans(input, searchConfig);
    const expandedPatterns =
      maxPatterns === undefined
        ? patternPlans.map((plan) => plan.pattern)
        : patternPlans.map((plan) => plan.pattern).slice(0, maxPatterns);
    const queryByPattern = new Map(
      patternPlans.map((plan) => [plan.pattern, plan.query])
    );
    const searchedSources = resolvedRoots.sources.map((source) => ({
      ...source,
    }));
    const warnings = [...resolvedRoots.warnings];
    const rawResults: SearchResult[] = [];
    const createBackend =
      this.options.createBackend ??
      ((source) =>
        createDefaultBackend(source, {
          fffMcp: this.options.fffMcp,
          timeoutMs: this.options.fffTimeoutMs,
          emptyResultRetryAttempts: this.options.fffEmptyResultRetryAttempts,
          emptyResultRetryDelayMs: this.options.fffEmptyResultRetryDelayMs,
        }));
    let attemptedSourceCount = 0;
    let failedSourceCount = 0;

    for (const source of searchedSources) {
      if (source.status !== "ok") {
        continue;
      }

      attemptedSourceCount += 1;
      let backend: SessionSearchBackend | undefined;
      try {
        backend = await createBackend(source);
        const backendInput: SessionSearchBackendInput = {
          patterns: expandedPatterns,
          maxResults: input.paths?.length ? undefined : maxResultsPerSource,
          context,
        };
        if (input.paths?.length) {
          backendInput.paths = input.paths;
        }
        if (source.include?.length) {
          backendInput.include = source.include;
        }
        const output = await backend.search(backendInput);
        warnings.push(...output.warnings);
        const sourceResults = output.results
          .filter((result) => resultMatchesSourceFilters(result, source, input))
          .slice(0, maxResultsPerSource)
          .map(truncateEvidenceResult)
          .map((result) =>
            result.pattern
              ? {
                  ...result,
                  query: queryByPattern.get(result.pattern),
                }
              : result
          );
        rawResults.push(...sourceResults);
        if (sourceResults.length === 0) {
          const backendFailure = output.warnings.find(isBackendFailureWarning);
          if (backendFailure) {
            source.status = "failed";
            source.warning = backendFailure.message;
            failedSourceCount += 1;
          }
        }
      } catch (error) {
        const message = `Search failed for source ${source.name}: ${errorMessage(error)}`;
        source.status = "failed";
        source.warning = message;
        failedSourceCount += 1;
        warnings.push({
          source: source.name,
          root: source.root,
          code: "source_search_failed",
          message,
        });
      } finally {
        await backend?.close?.();
      }
    }

    if (
      attemptedSourceCount > 0 &&
      failedSourceCount === attemptedSourceCount &&
      rawResults.length === 0
    ) {
      warnings.push({
        code: "all_sources_failed",
        message: allSourcesFailedMessage(input.query, searchedSources),
      });
    }

    const resultsDisplayMode =
      input.resultsDisplayMode ?? (input.debug ? "debug" : "candidates");
    const filteredResults = input.paths?.length
      ? rawResults.filter((result) => input.paths?.includes(result.path))
      : rawResults;
    const results =
      resultsDisplayMode === "candidates"
        ? toCandidates(filteredResults, input)
        : filteredResults;
    const shouldIncludeDebug = input.debug || resultsDisplayMode === "debug";

    return {
      query: input.query,
      resultsDisplayMode,
      expandedPatterns,
      searchedSources,
      warnings,
      results,
      ...(shouldIncludeDebug
        ? {
            debug: {
              input,
              expandedPatterns,
            },
          }
        : {}),
    };
  }
}

function toCandidates(
  results: SearchResult[],
  input: SearchSessionsInput
): SearchCandidate[] {
  const candidates = new Map<string, SearchCandidate>();

  for (const result of results) {
    const key = `${result.source}\0${result.path}`;
    const existing = candidates.get(key);
    if (existing) {
      existing.hitCount += 1;
      addUnique(existing.matchedPatterns, result.pattern);
      addUnique(existing.matchedQueries, result.query);
      if (
        result.line !== undefined &&
        (existing.line === undefined || result.line < existing.line)
      ) {
        existing.line = result.line;
        existing.preview = truncateUtf8(result.content, PREVIEW_MAX_BYTES);
      }
      continue;
    }

    const sessionId = sessionIdFromPath(result.path);
    candidates.set(key, {
      source: result.source,
      root: result.root,
      path: result.path,
      ...(sessionId ? { sessionId } : {}),
      line: result.line,
      preview: truncateUtf8(result.content, PREVIEW_MAX_BYTES),
      hitCount: 1,
      matchedQueries: result.query ? [result.query] : [],
      matchedPatterns: result.pattern ? [result.pattern] : [],
      more: {
        evidence: {
          query: input.query,
          ...(input.queries ? { queries: input.queries } : {}),
          sources: [result.source],
          resultsDisplayMode: "evidence",
          paths: [result.path],
        },
      },
    });
  }

  return Array.from(candidates.values());
}

function addUnique(values: string[], value: string | undefined) {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

function sessionIdFromPath(path: string) {
  return basename(path).match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
  )?.[0];
}

function expandPatternPlans(input: SearchSessionsInput, config: ConfigFile) {
  const hasPlannedQueries = Boolean(input.queries?.length);
  const queries = hasPlannedQueries ? input.queries! : [input.query];
  const plans: Array<{ query: string; pattern: string }> = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const patterns = hasPlannedQueries
      ? [query, ...rewriteQueryPatterns(query, { synonyms: config.synonyms })]
      : rewriteQueryPatterns(query, { synonyms: config.synonyms });
    for (const pattern of patterns) {
      if (seen.has(pattern)) {
        continue;
      }
      seen.add(pattern);
      plans.push({ query, pattern });
    }
  }

  return plans;
}

export type CreateSessionSearchOptions = Pick<
  ResolveSessionRootsInput,
  "configPath"
> & {
  defaultRoots?: SessionRootConfig[];
  createBackend?: CreateSessionSearchBackend;
  fffMcp?: CreateFffMcpClientOptions;
  fffTimeoutMs?: number;
  fffEmptyResultRetryAttempts?: number;
  fffEmptyResultRetryDelayMs?: number;
};

export function createSessionSearch(
  options: CreateSessionSearchOptions = {}
): SessionSearch {
  return new CoordinatedSessionSearch(options);
}

async function createDefaultBackend(
  source: ResolvedSessionSource,
  options: {
    fffMcp?: CreateFffMcpClientOptions;
    timeoutMs?: number;
    emptyResultRetryAttempts?: number;
    emptyResultRetryDelayMs?: number;
  } = {}
): Promise<SessionSearchBackend> {
  return new OneRootFffBackend({
    source: source.name,
    root: source.root,
    client: await createFffMcpClient(source.root, options.fffMcp),
    timeoutMs: options.timeoutMs ?? DEFAULT_FFF_TIMEOUT_MS,
    emptyResultRetryAttempts: options.emptyResultRetryAttempts,
    emptyResultRetryDelayMs: options.emptyResultRetryDelayMs,
  });
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isBackendFailureWarning(warning: { code: string }) {
  return (
    warning.code === "fff_backend_error" ||
    warning.code === "fff_backend_timeout"
  );
}

const DEFAULT_FFF_TIMEOUT_MS = 15_000;
const EVIDENCE_CONTENT_MAX_BYTES = 8_192;
const PREVIEW_MAX_BYTES = 500;

function resultMatchesSourceFilters(
  result: SearchResult,
  source: ResolvedSessionSource,
  input: SearchSessionsInput
) {
  if (!pathMatchesInclude(source.root, result.path, source.include)) {
    return false;
  }
  if (input.paths?.length && !input.paths.includes(result.path)) {
    return false;
  }
  return true;
}

function truncateEvidenceResult(result: SearchResult): SearchResult {
  return {
    ...result,
    content: truncateUtf8(result.content, EVIDENCE_CONTENT_MAX_BYTES),
  };
}

function truncateUtf8(value: string, maxBytes: number) {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }

  let output = "";
  let outputBytes = 0;
  const suffix = "...";
  const limit = Math.max(maxBytes - Buffer.byteLength(suffix, "utf8"), 0);
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (outputBytes + charBytes > limit) {
      break;
    }
    output += char;
    outputBytes += charBytes;
  }
  return `${output}${suffix}`;
}

function validatedDefaults(defaults: SearchDefaultsConfig | undefined) {
  return {
    maxPatterns: positiveInteger(defaults?.maxPatterns),
    maxResultsPerSource: positiveInteger(defaults?.maxResultsPerSource),
    context: nonNegativeInteger(defaults?.context),
  };
}

function positiveInteger(value: number | undefined) {
  return value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function nonNegativeInteger(value: number | undefined) {
  return value !== undefined && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function allSourcesFailedMessage(
  query: string,
  searchedSources: Array<{ root: string; status: string }>
) {
  const roots = searchedSources.map((source) => source.root);
  const rgCommand = [
    "rg",
    "--line-number",
    "--fixed-strings",
    shellQuote(query),
    ...roots.map(shellQuote),
  ].join(" ");
  return `All searchable sources failed. Fallback command: ${rgCommand}`;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
