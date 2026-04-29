import type {
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
  resolveSessionRoots,
  type ResolvedSessionSource,
  type ResolveSessionRootsInput,
  type SessionRootConfig,
} from "./roots.js";
import { rewriteQueryPatterns } from "./query-rewriter.js";

export type SessionSearchBackendInput = {
  patterns: string[];
  maxResults?: number;
  context?: number;
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
    const resolvedRoots = await resolveSessionRoots({
      sources: input.sources,
      configPath: this.options.configPath,
      defaultRoots: this.options.defaultRoots,
    });
    const searchConfig = await loadSearchConfig(this.options.configPath);
    const patternPlans = expandPatternPlans(input, searchConfig.synonyms);
    const expandedPatterns =
      input.maxPatterns === undefined
        ? patternPlans.map((plan) => plan.pattern)
        : patternPlans.map((plan) => plan.pattern).slice(0, input.maxPatterns);
    const queryByPattern = new Map(
      patternPlans.map((plan) => [plan.pattern, plan.query])
    );
    const shouldAnnotateResultQuery = Boolean(input.queries?.length);
    const searchedSources = resolvedRoots.sources.map((source) => ({
      ...source,
    }));
    const warnings = [...resolvedRoots.warnings];
    const results: SearchSessionsOutput["results"] = [];
    const createBackend =
      this.options.createBackend ??
      ((source) =>
        createDefaultBackend(source, {
          fffMcp: this.options.fffMcp,
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
        const output = await backend.search({
          patterns: expandedPatterns,
          maxResults: input.maxResultsPerSource,
          context: input.context,
        });
        warnings.push(...output.warnings);
        const sourceResults = output.results
          .slice(0, input.maxResultsPerSource)
          .map((result) =>
            shouldAnnotateResultQuery && result.pattern
              ? {
                  ...result,
                  query: queryByPattern.get(result.pattern),
                }
              : result
          );
        results.push(...sourceResults);
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
      results.length === 0
    ) {
      warnings.push({
        code: "all_sources_failed",
        message:
          "All searchable sources failed. Try rg directly against the configured source roots if FFF is unavailable.",
      });
    }

    return {
      query: input.query,
      expandedPatterns,
      searchedSources,
      warnings,
      results,
      ...(input.debug
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

function expandPatternPlans(
  input: SearchSessionsInput,
  synonyms: Record<string, string[]> | undefined
) {
  const hasPlannedQueries = Boolean(input.queries?.length);
  const queries = hasPlannedQueries ? input.queries! : [input.query];
  const plans: Array<{ query: string; pattern: string }> = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const patterns = hasPlannedQueries
      ? [query, ...rewriteQueryPatterns(query, { synonyms })]
      : rewriteQueryPatterns(query, { synonyms });
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
    emptyResultRetryAttempts?: number;
    emptyResultRetryDelayMs?: number;
  } = {}
): Promise<SessionSearchBackend> {
  return new OneRootFffBackend({
    source: source.name,
    root: source.root,
    client: await createFffMcpClient(source.root, options.fffMcp),
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
