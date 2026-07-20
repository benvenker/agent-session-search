import type {
  CandidateGroup,
  CallerSession,
  GroupCandidatesFollowupInput,
  GroupMembership,
  MatchGroupId,
  PatternPlan,
  RankingProjectMatch,
  RankingRecencyBucket,
  SearchBackendMetadata,
  SearchCandidate,
  SearchCandidateRankingDebug,
  SearchEvidenceGroup,
  SearchResult,
  SearchWarning,
  SearchSessionsDebug,
  SearchSessionsInput,
  SearchSessionsOutput,
  ResultsShape,
  SessionSearch,
  SourceName,
} from "./types.js";
import {
  groupCandidatesFingerprint,
  groupCandidatesFingerprintIsValid,
  groupCandidatesPlanFingerprint,
  stringArraysEqual,
  type GroupCandidatesFingerprintPayload,
} from "./followup.js";
import { SearchSessionsInputError } from "./tool.js";
import type { Dirent } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import {
  OneRootFffBackend,
  type CreateFffMcpClientOptions,
  type OneRootFffSearchOutput,
} from "./fff-backend.js";
import { createFffBackendPool } from "./client-pool.js";
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
import { planQueryPatterns } from "./query-rewriter.js";
import {
  applySessionFileFilters,
  prepareSessionFileFilters,
  resultIsAssociatedWithWorkspace,
  type PreparedSessionFileFilters,
  type SessionFileFilterDropReason,
} from "./session-filters.js";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  resolve,
  sep,
} from "node:path";

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
  private readonly defaultBackendPool;

  constructor(private readonly options: CreateSessionSearchOptions = {}) {
    this.defaultBackendPool = options.createBackend
      ? undefined
      : createFffBackendPool({
          fffMcp: options.fffMcp,
          timeoutMs: options.fffTimeoutMs ?? DEFAULT_FFF_TIMEOUT_MS,
          emptyResultRetryAttempts: options.fffEmptyResultRetryAttempts,
          emptyResultRetryDelayMs: options.fffEmptyResultRetryDelayMs,
        });
  }

  async searchSessions(
    input: SearchSessionsInput
  ): Promise<SearchSessionsOutput> {
    const replayNormalizedInput = effectiveSearchInput(input);
    const sessionFileFilters = await prepareSessionFileFilters(
      {
        days: replayNormalizedInput.days,
        workspace: replayNormalizedInput.workspace,
      },
      {
        now: this.options.now,
        getMetadataProjectPaths: async (result) =>
          (await projectSignalsFromCandidateMetadata(result)).paths,
      }
    );
    const effectiveInput =
      sessionFileFilters.workspaceForms?.[0] === undefined
        ? replayNormalizedInput
        : {
            ...replayNormalizedInput,
            workspace: sessionFileFilters.workspaceForms[0],
          };
    const searchConfig = await loadSearchConfig(this.options.configPath);
    const resolvedRoots = await resolveSessionRoots({
      sources: effectiveInput.sources,
      configPath: this.options.configPath,
      config: searchConfig,
      defaultRoots: this.options.defaultRoots,
    });
    const resultsDisplayMode =
      effectiveInput.resultsDisplayMode ??
      (effectiveInput.debug ? "debug" : "candidates");
    const defaults = validatedDefaults(searchConfig.defaults);
    const maxPatterns = effectiveInput.maxPatterns ?? defaults.maxPatterns;
    const isUnscopedEvidenceRequest =
      resultsDisplayMode === "evidence" && !effectiveInput.paths?.length;
    const isDefaultUnscopedEvidenceCapApplied =
      isUnscopedEvidenceRequest &&
      effectiveInput.maxResultsPerSource === undefined &&
      defaults.maxResultsPerSource === undefined;
    const maxResultsPerSource =
      effectiveInput.maxResultsPerSource ??
      defaults.maxResultsPerSource ??
      (isUnscopedEvidenceRequest
        ? DEFAULT_UNSCOPED_EVIDENCE_MAX_RESULTS_PER_SOURCE
        : undefined);
    const requestMaxResultsPerSource = effectiveInput.paths?.length
      ? effectiveInput.maxResultsPerSource
      : maxResultsPerSource;
    const context = effectiveInput.context ?? defaults.context;
    const patternPlans = expandPatternPlans(effectiveInput, searchConfig);
    const searchedPatternPlans =
      maxPatterns === undefined
        ? patternPlans
        : patternPlans.slice(0, maxPatterns);
    validateGroupCandidatesPlan(
      effectiveInput,
      searchedPatternPlans,
      groupCandidatesPlanFingerprint(
        searchedPatternPlans,
        resolvedRoots.sources
      )
    );
    const expandedPatterns = searchedPatternPlans.map((plan) => plan.pattern);
    const queryByPattern = new Map(
      searchedPatternPlans.map((plan) => [plan.pattern, plan.query])
    );
    const searchedSources = resolvedRoots.sources.map((source) => ({
      ...source,
    }));
    const warnings = [...resolvedRoots.warnings];
    const rawResults: SearchResult[] = [];
    const managedRouter =
      this.options.createBackend || !this.defaultBackendPool
        ? undefined
        : this.defaultBackendPool.createRouter(searchedSources);
    const createBackend =
      this.options.createBackend ??
      ((source: ResolvedSessionSource) =>
        this.defaultBackendPool!.createBackendFromRouter(
          source,
          managedRouter!
        ));
    let unscopedEvidenceCapReached = false;
    const backendMetadata: SearchBackendMetadata[] = [];
    const filterRemovalReasons = new Set<SessionFileFilterDropReason>();

    const sourceSlots = await Promise.all(
      searchedSources.map((source, index) =>
        searchSourceSlot({
          index,
          source,
          createBackend,
          input: effectiveInput,
          expandedPatterns,
          requestMaxResultsPerSource,
          context,
          queryByPattern,
          resultsDisplayMode,
          isDefaultUnscopedEvidenceCapApplied,
          maxResultsPerSource,
          sessionFileFilters,
        })
      )
    );
    const attemptedSlots = sourceSlots.filter((slot) => slot.attempted);
    const failedSourceCount = attemptedSlots.filter(
      (slot) => slot.failed
    ).length;

    for (const slot of sourceSlots) {
      const source = searchedSources[slot.index];
      if (slot.status === "failed") {
        source.status = "failed";
        source.warning = slot.warning;
      }
      warnings.push(...slot.warnings);
      rawResults.push(...slot.results);
      if (slot.backend) {
        backendMetadata.push(slot.backend);
      }
      unscopedEvidenceCapReached =
        unscopedEvidenceCapReached || slot.unscopedEvidenceCapReached;
      for (const reason of slot.filterRemovalReasons) {
        filterRemovalReasons.add(reason);
      }
    }

    if (unscopedEvidenceCapReached) {
      warnings.push({
        code: "broad_evidence_capped",
        message: `Unscoped evidence searches are capped at ${DEFAULT_UNSCOPED_EVIDENCE_MAX_RESULTS_PER_SOURCE} results per source. Use candidates first, then pass a candidate more.evidence payload or --path for focused evidence.`,
        recommendedAction:
          "Start with candidates mode, expand a promising group with more.groupCandidates, then request focused evidence with the selected candidate path.",
      });
    }

    if (
      attemptedSlots.length > 0 &&
      failedSourceCount === attemptedSlots.length &&
      rawResults.length === 0
    ) {
      warnings.push({
        code: "all_sources_failed",
        message: allSourcesFailedMessage(input.query, searchedSources),
        recommendedAction:
          "Verify source roots and fff-mcp with agent-session-search sources --json and agent-session-search-doctor. For exhaustive proof, run the rg fallback command in the warning message.",
      });
    }

    const filteredResults = effectiveInput.paths?.length
      ? rawResults.filter((result) =>
          effectiveInput.paths?.includes(result.path)
        )
      : rawResults;
    const workspaceKnown =
      effectiveInput.workspace !== undefined && filteredResults.length === 0
        ? await workspaceHasAssociatedSession(
            resolvedRoots.sources,
            sessionFileFilters
          )
        : undefined;
    if (workspaceKnown === false) {
      const checkedWorkspace = sessionFileFilters.workspace!;
      warnings.push({
        code: "workspace_unknown",
        message: `No session files are associated with workspace ${checkedWorkspace}.`,
        recommendedAction: `Verify the workspace path ${checkedWorkspace} and retry.`,
      });
    } else if (
      hasActiveSessionFilters(effectiveInput) &&
      filteredResults.length === 0 &&
      (filterRemovalReasons.size > 0 || workspaceKnown === true)
    ) {
      warnings.push({
        code: "filters_removed_all_results",
        message: "Active session filters removed every eligible result.",
        recommendedAction:
          filterRemovalRecommendedAction(filterRemovalReasons) ||
          "Adjust the query or widen the active session filters.",
      });
    }
    const { results, resultsShape, rankingDebug } = await shapeResults(
      filteredResults,
      effectiveInput,
      resultsDisplayMode,
      requestMaxResultsPerSource,
      searchedPatternPlans,
      {
        searchedSources: searchedSources.map((source) => source.name),
        planFingerprint: groupCandidatesPlanFingerprint(
          searchedPatternPlans,
          resolvedRoots.sources
        ),
        ...(maxPatterns !== undefined ? { maxPatterns } : {}),
        ...(maxResultsPerSource !== undefined ? { maxResultsPerSource } : {}),
        ...(context !== undefined ? { context } : {}),
      }
    );
    const shouldIncludeDebug =
      effectiveInput.debug || resultsDisplayMode === "debug";

    return {
      query: effectiveInput.query,
      resultsDisplayMode,
      resultsShape,
      metadata: searchMetadata({
        resultsDisplayMode,
        resultsShape,
        backendMetadata,
        maxPatterns,
        maxResultsPerSource,
        candidateGroupLeadLimit: candidateGroupLeadLimit(
          effectiveInput,
          requestMaxResultsPerSource
        ),
        unscopedEvidenceDefaultCap: isDefaultUnscopedEvidenceCapApplied
          ? DEFAULT_UNSCOPED_EVIDENCE_MAX_RESULTS_PER_SOURCE
          : undefined,
        filters: hasActiveSessionFilters(effectiveInput)
          ? {
              ...(effectiveInput.days !== undefined
                ? { days: effectiveInput.days }
                : {}),
              ...(effectiveInput.workspace !== undefined
                ? { workspace: sessionFileFilters.workspace }
                : {}),
            }
          : undefined,
      }),
      expandedPatterns,
      searchedSources,
      warnings,
      results,
      ...(shouldIncludeDebug
        ? {
            debug: {
              input: effectiveInput,
              expandedPatterns,
              ...(rankingDebug ? { ranking: rankingDebug } : {}),
            },
          }
        : {}),
    };
  }

  async close(): Promise<void> {
    await this.defaultBackendPool?.close();
  }
}

type SourceSearchSlotInput = {
  index: number;
  source: ResolvedSessionSource;
  createBackend: CreateSessionSearchBackend;
  input: SearchSessionsInput;
  expandedPatterns: string[];
  requestMaxResultsPerSource: number | undefined;
  context: number | undefined;
  queryByPattern: Map<string, string>;
  resultsDisplayMode: SearchSessionsOutput["resultsDisplayMode"];
  isDefaultUnscopedEvidenceCapApplied: boolean;
  maxResultsPerSource: number | undefined;
  sessionFileFilters: PreparedSessionFileFilters;
};

type SourceSearchSlotResult = {
  index: number;
  attempted: boolean;
  status: ResolvedSessionSource["status"];
  warning?: string;
  warnings: SearchWarning[];
  results: SearchResult[];
  failed: boolean;
  unscopedEvidenceCapReached: boolean;
  filterRemovalReasons: Set<SessionFileFilterDropReason>;
  backend?: SearchBackendMetadata;
};

async function searchSourceSlot({
  index,
  source,
  createBackend,
  input,
  expandedPatterns,
  requestMaxResultsPerSource,
  context,
  queryByPattern,
  resultsDisplayMode,
  isDefaultUnscopedEvidenceCapApplied,
  maxResultsPerSource,
  sessionFileFilters,
}: SourceSearchSlotInput): Promise<SourceSearchSlotResult> {
  if (source.status !== "ok") {
    return {
      index,
      attempted: false,
      status: source.status,
      warning: source.warning,
      warnings: [],
      results: [],
      failed: false,
      unscopedEvidenceCapReached: false,
      filterRemovalReasons: new Set(),
    };
  }

  const warnings: SearchWarning[] = [];
  const results: SearchResult[] = [];
  let backend: SessionSearchBackend | undefined;
  let status: ResolvedSessionSource["status"] = "ok";
  let warning: string | undefined;
  let failed = false;
  let unscopedEvidenceCapReached = false;
  let backendMetadata: SearchBackendMetadata | undefined;
  const filterRemovalReasons = new Set<SessionFileFilterDropReason>();

  try {
    backend = await createBackend(source);
    const shouldDeferCandidateCap = resultsDisplayMode === "candidates";
    const backendInput: SessionSearchBackendInput = {
      patterns: expandedPatterns,
      maxResults:
        shouldDeferCandidateCap || shouldDeferBackendCap(source, input)
          ? undefined
          : requestMaxResultsPerSource,
      context,
    };
    if (input.paths?.length) {
      backendInput.paths = input.paths;
    }
    if (source.include?.length) {
      backendInput.include = source.include;
    }

    const output = await backend.search(backendInput);
    backendMetadata = output.backend;
    warnings.push(...output.warnings);
    const canonicalResults = await Promise.all(
      output.results.map((result) => canonicalizeSearchResult(result, source))
    );
    const filteredCanonicalResults = canonicalResults.filter((result) =>
      resultMatchesSourceFilters(result, source, input)
    );
    const sessionFilteredResults = await applySessionFileFilters(
      filteredCanonicalResults,
      sessionFileFilters
    );
    for (const dropped of sessionFilteredResults.dropped) {
      filterRemovalReasons.add(dropped.reason);
    }
    const sourceResults = maybeCapResults(
      sessionFilteredResults.results,
      shouldDeferCandidateCap ? undefined : requestMaxResultsPerSource
    )
      .map(truncateEvidenceResult)
      .map((result) =>
        result.pattern || result.patterns?.length
          ? {
              ...result,
              ...(result.pattern
                ? { query: queryByPattern.get(result.pattern) }
                : {}),
              ...(result.patterns?.length
                ? {
                    queries: uniqueStrings(
                      result.patterns
                        .map((pattern) => queryByPattern.get(pattern))
                        .filter(isString)
                    ),
                  }
                : {}),
            }
          : result
      );

    if (
      isDefaultUnscopedEvidenceCapApplied &&
      maxResultsPerSource !== undefined &&
      sourceResults.length >= maxResultsPerSource
    ) {
      unscopedEvidenceCapReached = true;
    }
    results.push(...sourceResults);

    if (sourceResults.length === 0) {
      const backendFailure = output.warnings.find(isBackendFailureWarning);
      if (backendFailure) {
        status = "failed";
        warning = backendFailure.message;
        failed = true;
      }
    }
  } catch (error) {
    const message = `Search failed for source ${source.name}: ${errorMessage(error)}`;
    status = "failed";
    warning = message;
    failed = true;
    warnings.push({
      source: source.name,
      root: source.root,
      code: "source_search_failed",
      message,
    });
  } finally {
    try {
      await backend?.close?.();
    } catch (error) {
      warnings.push({
        source: source.name,
        root: source.root,
        code: "source_cleanup_failed",
        message: `Cleanup failed for source ${source.name}: ${errorMessage(error)}`,
      });
    }
  }

  return {
    index,
    attempted: true,
    status,
    ...(warning ? { warning } : {}),
    warnings,
    results,
    failed,
    unscopedEvidenceCapReached,
    filterRemovalReasons,
    ...(backendMetadata ? { backend: backendMetadata } : {}),
  };
}

function hasActiveSessionFilters(input: SearchSessionsInput) {
  return input.days !== undefined || input.workspace !== undefined;
}

function filterRemovalRecommendedAction(
  reasons: Set<SessionFileFilterDropReason>
) {
  const remedies: string[] = [];
  if (reasons.has("days")) {
    remedies.push("Widen days to include older session files.");
  }
  if (reasons.has("workspace")) {
    remedies.push(
      "Verify or widen workspace to include the intended sessions."
    );
  }
  if (reasons.has("stat_failed")) {
    remedies.push("Verify session-file readability and mtime availability.");
  }
  return remedies.join(" ");
}

async function workspaceHasAssociatedSession(
  sources: ResolvedSessionSource[],
  filters: PreparedSessionFileFilters
) {
  for (const source of sources) {
    if (source.status !== "ok") continue;
    const pendingDirectories = [source.root];
    while (pendingDirectories.length > 0) {
      const directory = pendingDirectories.pop()!;
      let entries: Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          pendingDirectories.push(path);
          continue;
        }
        if (
          entry.isFile() &&
          pathMatchesInclude(source.root, path, source.include) &&
          (await resultIsAssociatedWithWorkspace(
            { source: source.name, path },
            filters
          ))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

async function canonicalizeSearchResult(
  result: SearchResult,
  source: ResolvedSessionSource
): Promise<SearchResult> {
  const absolutePath = isAbsolute(result.path)
    ? result.path
    : join(source.root, result.path);
  let path = normalize(absolutePath);

  try {
    path = await realpath(path);
  } catch {
    try {
      path = join(await realpath(dirname(path)), basename(path));
    } catch {
      // Search results can point at files deleted between backend search and
      // shaping. Keep an absolute normalized path rather than dropping evidence.
    }
  }

  return {
    ...result,
    root: source.root,
    path,
  };
}

async function shapeResults(
  results: SearchResult[],
  input: SearchSessionsInput,
  resultsDisplayMode: SearchSessionsOutput["resultsDisplayMode"],
  maxResultsPerSource: number | undefined,
  patternPlans: PatternPlan[],
  continuationState: GroupCandidatesContinuationState
): Promise<{
  results: SearchSessionsOutput["results"];
  resultsShape: ResultsShape;
  rankingDebug?: SearchSessionsDebug["ranking"];
}> {
  if (resultsDisplayMode === "candidates") {
    const { candidates, ranking } = await toCandidates(results, input);
    const grouped = toCandidateGroups({
      candidates,
      results,
      input,
      patternPlans,
      limit: candidateGroupLeadLimit(input, maxResultsPerSource),
      continuationState,
    });
    return {
      results: grouped,
      resultsShape: "candidate_groups",
      ...(input.debug
        ? {
            rankingDebug: {
              candidates: rankingDebugForDisplayedLeads(ranking, grouped),
            },
          }
        : {}),
    };
  }

  if (resultsDisplayMode === "evidence" && !input.paths?.length) {
    return {
      results: toEvidenceGroups(results, input),
      resultsShape: "evidence_groups",
    };
  }

  return {
    results,
    resultsShape: "evidence_hits",
  };
}

async function toCandidates(
  results: SearchResult[],
  input: SearchSessionsInput
): Promise<{
  candidates: SearchCandidate[];
  ranking: RankedCandidate[];
}> {
  const candidates = new Map<string, CandidateAccumulator>();

  for (const result of results) {
    const key = `${result.source}\0${result.path}`;
    const existing = candidates.get(key);
    if (existing) {
      existing.candidate.hitCount += 1;
      existing.patternMatchCount += candidatePatternMatchCount(result);
      addUniqueValues(
        existing.candidate.matchedPatterns,
        resultPatterns(result)
      );
      addUniqueValues(existing.candidate.matchedQueries, resultQueries(result));
      if (
        result.line !== undefined &&
        (existing.candidate.line === undefined ||
          result.line < existing.candidate.line)
      ) {
        existing.candidate.line = result.line;
        existing.candidate.preview = truncateUtf8(
          result.content,
          PREVIEW_MAX_BYTES
        );
      }
      continue;
    }

    const sessionId = sessionIdFromPath(result.path);
    candidates.set(key, {
      candidate: {
        source: result.source,
        root: result.root,
        path: result.path,
        ...(sessionId ? { sessionId } : {}),
        line: result.line,
        preview: truncateUtf8(result.content, PREVIEW_MAX_BYTES),
        hitCount: 1,
        matchedQueries: resultQueries(result),
        matchedPatterns: resultPatterns(result),
        more: evidenceFollowup(input, result.source, result.path),
      },
      patternMatchCount: candidatePatternMatchCount(result),
    });
  }

  return orderCandidates(
    Array.from(candidates.values()),
    await projectSignalsFromOperationalContext(input.operationalContext),
    input
  );
}

function candidatePatternMatchCount(result: SearchResult) {
  return Math.max(resultPatterns(result).length, 1);
}

function capCandidatesPerSource(
  candidates: SearchCandidate[],
  maxResultsPerSource: number | undefined
) {
  if (maxResultsPerSource === undefined) {
    return candidates;
  }

  const counts = new Map<string, number>();
  return candidates.filter((candidate) => {
    const count = counts.get(candidate.source) ?? 0;
    if (count >= maxResultsPerSource) {
      return false;
    }
    counts.set(candidate.source, count + 1);
    return true;
  });
}

type CandidateGroupsInput = {
  candidates: SearchCandidate[];
  results: SearchResult[];
  input: SearchSessionsInput;
  patternPlans: PatternPlan[];
  limit: number;
  continuationState: GroupCandidatesContinuationState;
};

function toCandidateGroups({
  candidates,
  results,
  input,
  patternPlans,
  limit,
  continuationState,
}: CandidateGroupsInput): CandidateGroup[] {
  const patternByLiteral = new Map(
    patternPlans.map((plan) => [plan.pattern, plan])
  );
  const hitsByCandidate = new Map<string, SearchResult[]>();
  for (const result of results) {
    const key = candidateKey(result.source, result.path);
    const hits = hitsByCandidate.get(key);
    if (hits) {
      hits.push(result);
    } else {
      hitsByCandidate.set(key, [result]);
    }
  }

  const assigned = new Map<MatchGroupId, SearchCandidate[]>(
    MATCH_GROUPS.map((group) => [group.id, []])
  );

  for (const candidate of candidates) {
    const memberships = groupMembershipsForCandidate(
      hitsByCandidate.get(candidateKey(candidate.source, candidate.path)) ?? [],
      patternByLiteral
    );
    if (memberships.length === 0) {
      continue;
    }
    candidate.groupMemberships = memberships;
    candidate.strongestGroup = memberships[0];
    assigned.get(memberships[0].id)?.push(candidate);
  }

  const groups: CandidateGroup[] = [];
  const groupsToBuild = input.groupCandidates
    ? MATCH_GROUPS.filter(
        (group) => group.id === input.groupCandidates?.group.id
      )
    : MATCH_GROUPS;
  for (const group of groupsToBuild) {
    const groupCandidates = assigned.get(group.id) ?? [];
    if (groupCandidates.length === 0) {
      continue;
    }
    const offset =
      input.groupCandidates?.group.id === group.id
        ? input.groupCandidates.offset
        : 0;
    const shown = groupCandidates.slice(offset, offset + limit);
    const hasMore = offset + shown.length < groupCandidates.length;
    const patternIds = patternIdsForGroup(group.id, patternPlans);
    groups.push({
      id: group.id,
      priority: group.priority,
      label: group.label,
      guidance: group.guidance,
      patternIds,
      assignedCandidateCount: {
        value: groupCandidates.length,
        relation: "eq",
      },
      hitCount: {
        value: physicalHitCountForGroup(
          group.id,
          groupCandidates,
          hitsByCandidate,
          patternByLiteral
        ),
        relation: "eq",
      },
      shownLeadCount: shown.length,
      hasMore,
      leads: shown,
      ...(hasMore
        ? {
            more: {
              groupCandidates: groupFollowup(
                input,
                group,
                patternIds,
                {
                  offset: offset + shown.length,
                  limit,
                },
                continuationState
              ),
            },
          }
        : {}),
    });
  }
  return groups;
}

type GroupCandidatesContinuationState = {
  searchedSources: SourceName[];
  planFingerprint: string;
  maxPatterns?: number;
  maxResultsPerSource?: number;
  context?: number;
};

function groupMembershipsForCandidate(
  hits: SearchResult[],
  patternByLiteral: Map<string, PatternPlan>
): GroupMembership[] {
  const memberships = new Map<MatchGroupId, Set<string>>();
  const naturalPatternIds = new Set<string>();

  for (const hit of hits) {
    for (const pattern of resultPatterns(hit)) {
      const plan = patternByLiteral.get(pattern);
      if (!plan) {
        continue;
      }
      addMembershipPattern(memberships, plan.initialGroup, plan.id);
      if (plan.provenance === "natural_term") {
        naturalPatternIds.add(plan.id);
      }
    }
  }

  if (naturalPatternIds.size >= 2) {
    memberships.set("multi_term_coverage", naturalPatternIds);
  }

  return Array.from(memberships.entries())
    .map(([id, patternIds]) => ({
      id,
      priority: matchGroupDefinition(id).priority,
      patternIds: Array.from(patternIds).sort(comparePatternIds),
    }))
    .sort((a, b) => a.priority - b.priority);
}

function addMembershipPattern(
  memberships: Map<MatchGroupId, Set<string>>,
  groupId: MatchGroupId,
  patternId: string
) {
  const existing = memberships.get(groupId);
  if (existing) {
    existing.add(patternId);
  } else {
    memberships.set(groupId, new Set([patternId]));
  }
}

function physicalHitCountForGroup(
  groupId: MatchGroupId,
  candidates: SearchCandidate[],
  hitsByCandidate: Map<string, SearchResult[]>,
  patternByLiteral: Map<string, PatternPlan>
) {
  let count = 0;
  for (const candidate of candidates) {
    const hits =
      hitsByCandidate.get(candidateKey(candidate.source, candidate.path)) ?? [];
    for (const hit of hits) {
      if (hitMatchesGroup(hit, groupId, patternByLiteral)) {
        count += 1;
      }
    }
  }
  return count;
}

function hitMatchesGroup(
  hit: SearchResult,
  groupId: MatchGroupId,
  patternByLiteral: Map<string, PatternPlan>
) {
  if (groupId === "multi_term_coverage") {
    return true;
  }
  return resultPatterns(hit).some(
    (pattern) => patternByLiteral.get(pattern)?.initialGroup === groupId
  );
}

function patternIdsForGroup(
  groupId: MatchGroupId,
  patternPlans: PatternPlan[]
) {
  if (groupId === "multi_term_coverage") {
    return patternPlans
      .filter((plan) => plan.provenance === "natural_term")
      .map((plan) => plan.id);
  }
  return patternPlans
    .filter((plan) => plan.initialGroup === groupId)
    .map((plan) => plan.id);
}

function validateGroupCandidatesPlan(
  input: SearchSessionsInput,
  patternPlans: PatternPlan[],
  planFingerprint: string
) {
  const followup = input.groupCandidates;
  if (!followup) {
    return;
  }

  if (!groupCandidatesFingerprintIsValid(followup)) {
    throw new SearchSessionsInputError(
      "groupCandidates.fingerprint",
      "Invalid group follow-up: groupCandidates must be copied exactly from the server-prepared payload."
    );
  }

  const group = MATCH_GROUPS.find((item) => item.id === followup.group.id);
  if (!group) {
    throw new SearchSessionsInputError(
      "groupCandidates.group.id",
      "Invalid group follow-up: groupCandidates.group.id does not match a known candidate group."
    );
  }
  if (followup.group.priority !== group.priority) {
    throw new SearchSessionsInputError(
      "groupCandidates.group.priority",
      "Invalid group follow-up: groupCandidates.group.priority does not match the current query plan."
    );
  }

  const expectedPatternIds = patternIdsForGroup(group.id, patternPlans);
  if (!stringArraysEqual(followup.group.patternIds, expectedPatternIds)) {
    throw new SearchSessionsInputError(
      "groupCandidates.group.patternIds",
      "Invalid group follow-up: groupCandidates.group.patternIds do not match the current query plan."
    );
  }

  if (followup.planFingerprint !== planFingerprint) {
    throw new SearchSessionsInputError(
      "groupCandidates.planFingerprint",
      "Invalid group follow-up: groupCandidates.planFingerprint no longer matches the current query plan or resolved sources. Re-run the original search and use the new server-prepared payload."
    );
  }
}

function groupFollowup(
  input: SearchSessionsInput,
  group: MatchGroupDefinition,
  patternIds: string[],
  page: { offset: number; limit: number },
  continuationState: GroupCandidatesContinuationState
): GroupCandidatesFollowupInput {
  const payload: GroupCandidatesFingerprintPayload = {
    query: input.query,
    ...(input.queries ? { queries: input.queries } : {}),
    ...(input.operationalContext !== undefined
      ? { operationalContext: input.operationalContext }
      : {}),
    ...(input.callerSession !== undefined
      ? { callerSession: input.callerSession }
      : {}),
    sources: continuationState.searchedSources,
    resultsDisplayMode: "candidates",
    ...(input.paths ? { paths: input.paths } : {}),
    ...(input.days !== undefined ? { days: input.days } : {}),
    ...(input.workspace !== undefined ? { workspace: input.workspace } : {}),
    ...(continuationState.maxPatterns !== undefined
      ? { maxPatterns: continuationState.maxPatterns }
      : {}),
    ...(continuationState.maxResultsPerSource !== undefined
      ? { maxResultsPerSource: continuationState.maxResultsPerSource }
      : {}),
    ...(continuationState.context !== undefined
      ? { context: continuationState.context }
      : {}),
    planFingerprint: continuationState.planFingerprint,
    group: {
      id: group.id,
      priority: group.priority,
      patternIds,
    },
    offset: page.offset,
    limit: page.limit,
  };
  return {
    ...payload,
    fingerprint: groupCandidatesFingerprint(payload),
  };
}

function candidateGroupLeadLimit(
  input: SearchSessionsInput,
  maxResultsPerSource: number | undefined
) {
  return input.groupCandidates?.limit ?? maxResultsPerSource ?? 5;
}

function candidateKey(source: SearchResult["source"], path: string) {
  return `${source}\0${path}`;
}

function comparePatternIds(a: string, b: string) {
  return Number(a.slice(1)) - Number(b.slice(1));
}

type MatchGroupDefinition = {
  id: MatchGroupId;
  priority: number;
  label: string;
  guidance: string;
};

const MATCH_GROUPS: MatchGroupDefinition[] = [
  {
    id: "exact_or_structured",
    priority: 0,
    label: "Exact or structured",
    guidance:
      "Treat as strongest evidence and inspect first when it matches the task.",
  },
  {
    id: "phrase_or_adjacent_terms",
    priority: 1,
    label: "Phrase or adjacent terms",
    guidance: "Use when exact structure is absent or sparse.",
  },
  {
    id: "multi_term_coverage",
    priority: 2,
    label: "Multi-term coverage",
    guidance: "Prefer over repeated hits for one generic term.",
  },
  {
    id: "distinctive_term",
    priority: 3,
    label: "Distinctive term",
    guidance: "Use as a lead when higher groups are thin.",
  },
  {
    id: "loose_fallback",
    priority: 4,
    label: "Loose fallback",
    guidance: "Treat as exploratory evidence only.",
  },
];

function matchGroupDefinition(id: MatchGroupId) {
  return MATCH_GROUPS.find((group) => group.id === id)!;
}

type ProjectSignals = {
  paths: string[];
  tokens: Map<string, Exclude<RankingProjectMatch, "none" | "path">>;
};

type CandidateProjectSignals = {
  paths: string[];
  tokens: Set<string>;
};

type RankedCandidate = {
  candidate: SearchCandidate;
  patternMatchCount: number;
  rank: number;
  originalIndex: number;
  mtimeMs?: number;
  recencyBucket: RankingRecencyBucket;
  recencyPoints: number;
  densityPoints: number;
  projectMatch: RankingProjectMatch;
  projectPoints: number;
  score: number;
  current: boolean;
};

type CandidateAccumulator = {
  candidate: SearchCandidate;
  patternMatchCount: number;
};

async function orderCandidates(
  candidates: CandidateAccumulator[],
  projectSignals: ProjectSignals,
  input: SearchSessionsInput
): Promise<{
  candidates: SearchCandidate[];
  ranking: RankedCandidate[];
}> {
  const currentSession = currentSessionForInput(input);
  const ranked = await Promise.all(
    candidates.map(async ({ candidate, patternMatchCount }, originalIndex) => {
      const mtimeMs = await candidateMtimeMs(candidate.path);
      const recencyBucket = recencyBucketForMtime(mtimeMs);
      const recencyScore = recencyPoints(recencyBucket);
      const densityScore = densityPoints(patternMatchCount);
      const projectMatch = await projectMatchForCandidate(
        candidate,
        projectSignals
      );
      const projectScore = projectPoints(projectMatch);
      return {
        candidate,
        patternMatchCount,
        rank: 0,
        originalIndex,
        mtimeMs,
        recencyBucket,
        recencyPoints: recencyScore,
        densityPoints: densityScore,
        projectMatch,
        projectPoints: projectScore,
        score:
          recencyScore * RECENCY_SCORE_WEIGHT + densityScore + projectScore,
        current: await isCurrentSessionCandidate(candidate, currentSession),
      };
    })
  );

  ranked.sort(compareRankedCandidates);
  ranked.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });
  return {
    candidates: ranked.map((rank) => rank.candidate),
    ranking: ranked,
  };
}

function compareRankedCandidates(a: RankedCandidate, b: RankedCandidate) {
  return (
    Number(a.current) - Number(b.current) ||
    b.score - a.score ||
    b.patternMatchCount - a.patternMatchCount ||
    b.candidate.hitCount - a.candidate.hitCount ||
    (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0) ||
    a.candidate.source.localeCompare(b.candidate.source) ||
    a.candidate.path.localeCompare(b.candidate.path) ||
    a.originalIndex - b.originalIndex
  );
}

function rankingDebugForDisplayedLeads(
  ranking: RankedCandidate[],
  groups: CandidateGroup[]
) {
  const displayed = new Set(
    groups.flatMap((group) =>
      group.leads.map((lead) => candidateKey(lead.source, lead.path))
    )
  );
  return ranking
    .filter((rank) =>
      displayed.has(candidateKey(rank.candidate.source, rank.candidate.path))
    )
    .map(toCandidateRankingDebug);
}

function toCandidateRankingDebug(
  ranked: RankedCandidate
): SearchCandidateRankingDebug {
  return {
    rank: ranked.rank,
    source: ranked.candidate.source,
    path: ranked.candidate.path,
    ...(ranked.candidate.sessionId
      ? { sessionId: ranked.candidate.sessionId }
      : {}),
    hitCount: ranked.candidate.hitCount,
    patternMatchCount: ranked.patternMatchCount,
    originalIndex: ranked.originalIndex,
    isCurrentSession: ranked.current,
    ...(ranked.mtimeMs !== undefined ? { mtimeMs: ranked.mtimeMs } : {}),
    recencyBucket: ranked.recencyBucket,
    recencyPoints: ranked.recencyPoints,
    densityPoints: ranked.densityPoints,
    projectMatch: ranked.projectMatch,
    projectPoints: ranked.projectPoints,
    score: ranked.score,
    ...(ranked.candidate.strongestGroup
      ? { strongestGroup: ranked.candidate.strongestGroup }
      : {}),
    ...(ranked.candidate.groupMemberships
      ? { groupMemberships: ranked.candidate.groupMemberships }
      : {}),
  };
}

async function projectMatchForCandidate(
  candidate: SearchCandidate,
  projectSignals: ProjectSignals
): Promise<RankingProjectMatch> {
  if (projectSignals.paths.length === 0 && projectSignals.tokens.size === 0) {
    return "none";
  }
  if (
    projectSignals.paths.some(
      (projectPath) =>
        pathIsWithin(candidate.path, projectPath) ||
        pathIsWithin(candidate.root, projectPath)
    )
  ) {
    return "path";
  }

  const metadataSignals = await projectSignalsFromCandidateMetadata(candidate);
  if (
    projectSignals.paths.some((projectPath) =>
      metadataSignals.paths.some(
        (metadataPath) =>
          pathIsWithin(metadataPath, projectPath) ||
          pathIsWithin(projectPath, metadataPath)
      )
    )
  ) {
    return "path";
  }

  const candidateTokens = tokensFromPathMetadata(
    candidate.root,
    candidate.path
  );
  addTokens(candidateTokens, metadataSignals.tokens);
  for (const [token, match] of projectSignals.tokens) {
    if (candidateTokens.has(token)) {
      return match;
    }
  }
  return "none";
}

function projectPoints(match: RankingProjectMatch) {
  return match === "none" ? 0 : PROJECT_SCORE_BOOST;
}

async function projectSignalsFromCandidateMetadata(
  candidate: Pick<SearchCandidate, "source" | "path">
): Promise<CandidateProjectSignals> {
  const signals = { paths: [] as string[], tokens: new Set<string>() };
  if (!mayContainSessionMetadata(candidate)) {
    return signals;
  }

  const prefix = await readFilePrefix(
    candidate.path,
    SESSION_METADATA_MAX_BYTES
  );
  if (!prefix) {
    return signals;
  }

  const lines = prefix.split(/\r?\n/).slice(0, SESSION_METADATA_MAX_LINES);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const record = parseJsonObject(trimmed);
    if (!record) {
      continue;
    }

    await addSessionMetadataSignals(signals, record);
    const payload = record.payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      await addSessionMetadataSignals(
        signals,
        payload as Record<string, unknown>
      );
    }
  }
  return signals;
}

function mayContainSessionMetadata(
  candidate: Pick<SearchCandidate, "source" | "path">
) {
  if (candidate.source === "codex" || candidate.source === "pi") {
    return true;
  }
  const lowerPath = candidate.path.toLowerCase();
  return lowerPath.endsWith(".jsonl") || lowerPath.endsWith(".ndjson");
}

async function addSessionMetadataSignals(
  signals: CandidateProjectSignals,
  record: Record<string, unknown>
) {
  for (const field of PROJECT_CONTEXT_FIELDS) {
    const value = record[field];
    if (typeof value !== "string" || value.trim() === "") {
      continue;
    }
    await addSessionMetadataSignal(signals, field, value.trim());
  }
}

async function addSessionMetadataSignal(
  signals: CandidateProjectSignals,
  field: string,
  value: string
) {
  if (field === "repo" && !isLocalPathLike(value)) {
    addTokens(
      signals.tokens,
      tokensFromName(value.split(/[\\/]/).at(-1) ?? value)
    );
    return;
  }

  const canonicalPath = await canonicalProjectPath(value);
  const tokens = tokensFromProjectPath(canonicalPath);
  addTokens(signals.tokens, tokens);
  if (tokens.size > 0 && !signals.paths.includes(canonicalPath)) {
    signals.paths.push(canonicalPath);
  }
}

async function readFilePrefix(path: string, maxBytes: number) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function projectSignalsFromOperationalContext(
  operationalContext: unknown
): Promise<ProjectSignals> {
  const signals: ProjectSignals = { paths: [], tokens: new Map() };
  if (
    operationalContext === null ||
    typeof operationalContext !== "object" ||
    Array.isArray(operationalContext)
  ) {
    return signals;
  }

  const context = operationalContext as Record<string, unknown>;
  for (const field of PROJECT_CONTEXT_FIELDS) {
    const value = context[field];
    if (typeof value !== "string" || value.trim() === "") {
      continue;
    }
    await addProjectSignal(signals, field, value.trim());
  }
  return signals;
}

async function addProjectSignal(
  signals: ProjectSignals,
  field: string,
  value: string
) {
  if (field === "repo" && !isLocalPathLike(value)) {
    addProjectTokens(
      signals.tokens,
      tokensFromName(value.split(/[\\/]/).at(-1) ?? value),
      "repo_token"
    );
    return;
  }

  const canonicalPath = await canonicalProjectPath(value);
  const tokens = tokensFromProjectPath(canonicalPath);
  addProjectTokens(signals.tokens, tokens, "other_safe_metadata");
  if (tokens.size > 0) {
    signals.paths.push(canonicalPath);
  }
}

export async function canonicalProjectPath(value: string) {
  if (isUnexpandedHomeProjectPath(value) && !process.env.HOME) {
    return value;
  }
  const expanded = expandHomeProjectPath(value);
  try {
    return await realpath(expanded);
  } catch {
    if (isUnexpandedHomeProjectPath(expanded)) {
      return normalize(expanded);
    }
    return isAbsolute(expanded) ? normalize(expanded) : resolve(expanded);
  }
}

function expandHomeProjectPath(value: string) {
  if (!isUnexpandedHomeProjectPath(value)) {
    return value;
  }
  const home = process.env.HOME;
  if (!home) {
    return value;
  }
  if (value === "~") {
    return home;
  }
  return join(home, value.slice(2));
}

function isUnexpandedHomeProjectPath(value: string) {
  return value === "~" || value.startsWith("~/") || value.startsWith("~\\");
}

function isLocalPathLike(value: string) {
  return (
    isAbsolute(value) ||
    value.startsWith(".") ||
    value.startsWith("~") ||
    value.includes("\\")
  );
}

function tokensFromPathMetadata(...paths: string[]) {
  const tokens = new Set<string>();
  for (const path of paths) {
    for (const segment of path.split(/[\\/]+/)) {
      addTokens(tokens, tokensFromName(segment));
    }
  }
  return tokens;
}

function tokensFromProjectPath(path: string) {
  const tokens = new Set<string>();
  const segments = path.split(/[\\/]+/).filter(Boolean);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    addTokens(tokens, tokensFromName(segments[index]));
    if (tokens.size > 0) {
      return tokens;
    }
  }
  return tokens;
}

function tokensFromName(value: string) {
  const stem = value
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (!stem || GENERIC_PROJECT_TOKENS.has(stem)) {
    return [];
  }

  const parts = stem
    .split(/[^a-z0-9]+/)
    .filter((part) => isSpecificProjectToken(part));
  if (parts.length === 0) {
    return [];
  }
  if (parts.length === 1) {
    return [parts[0]];
  }

  const tokens = [parts.join("-")];
  for (let index = 1; index < parts.length - 1; index += 1) {
    tokens.push(parts.slice(index).join("-"));
  }
  return tokens;
}

function addTokens(target: Set<string>, tokens: Iterable<string>) {
  for (const token of tokens) {
    if (isSpecificProjectToken(token)) {
      target.add(token);
    }
  }
}

function addProjectTokens(
  target: ProjectSignals["tokens"],
  tokens: Iterable<string>,
  match: Exclude<RankingProjectMatch, "none" | "path">
) {
  for (const token of tokens) {
    if (isSpecificProjectToken(token) && !target.has(token)) {
      target.set(token, match);
    }
  }
}

function isSpecificProjectToken(token: string) {
  return token.length > 1 && !GENERIC_PROJECT_TOKENS.has(token);
}

function pathIsWithin(path: string, parent: string) {
  const normalizedPath = normalize(path);
  const normalizedParent = normalize(parent);
  return (
    normalizedPath === normalizedParent ||
    normalizedPath.startsWith(
      normalizedParent.endsWith(sep)
        ? normalizedParent
        : `${normalizedParent}${sep}`
    )
  );
}

async function candidateMtimeMs(path: string) {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
}

function recencyBucketForMtime(
  mtimeMs: number | undefined
): RankingRecencyBucket {
  if (mtimeMs === undefined) {
    return "older_or_missing";
  }
  const ageMs = Date.now() - mtimeMs;
  if (ageMs <= 2 * HOUR_MS) {
    return "lt_2h";
  }
  if (ageMs <= 24 * HOUR_MS) {
    return "lt_24h";
  }
  if (ageMs <= 7 * DAY_MS) {
    return "lt_7d";
  }
  if (ageMs <= 30 * DAY_MS) {
    return "lt_30d";
  }
  return "older_or_missing";
}

function recencyPoints(bucket: RankingRecencyBucket) {
  if (bucket === "lt_2h") {
    return 4;
  }
  if (bucket === "lt_24h") {
    return 3;
  }
  if (bucket === "lt_7d") {
    return 2;
  }
  if (bucket === "lt_30d") {
    return 1;
  }
  return 0;
}

function densityPoints(hitCount: number) {
  return Math.min(Math.log2(hitCount + 1), 4);
}

async function isCurrentSessionCandidate(
  candidate: SearchCandidate,
  currentSession: CallerSession | undefined
) {
  if (
    currentSession === undefined ||
    candidate.source !== currentSession.source ||
    candidate.sessionId === undefined
  ) {
    return false;
  }
  if (candidate.sessionId === currentSession.sessionId) {
    return true;
  }
  return codexCandidateHasParentThread(candidate, currentSession.sessionId);
}

async function codexCandidateHasParentThread(
  candidate: SearchCandidate,
  callerSessionId: string
) {
  if (candidate.source !== "codex") {
    return false;
  }

  const prefix = await readFilePrefix(
    candidate.path,
    SESSION_METADATA_MAX_BYTES
  );
  if (!prefix) {
    return false;
  }

  const lines = prefix.split(/\r?\n/).slice(0, SESSION_METADATA_MAX_LINES);
  for (const line of lines) {
    const record = parseJsonObject(line.trim());
    if (!record) {
      continue;
    }
    if (codexMetadataParentThreadId(record) === callerSessionId) {
      return true;
    }
    const payload = record.payload;
    if (
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      codexMetadataParentThreadId(payload as Record<string, unknown>) ===
        callerSessionId
    ) {
      return true;
    }
  }
  return false;
}

function codexMetadataParentThreadId(record: Record<string, unknown>) {
  const direct = record.parent_thread_id;
  if (typeof direct === "string") {
    return direct;
  }

  const source = record.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }
  const subagent = (source as Record<string, unknown>).subagent;
  if (!subagent || typeof subagent !== "object" || Array.isArray(subagent)) {
    return undefined;
  }
  const threadSpawn = (subagent as Record<string, unknown>).thread_spawn;
  if (
    !threadSpawn ||
    typeof threadSpawn !== "object" ||
    Array.isArray(threadSpawn)
  ) {
    return undefined;
  }
  const nested = (threadSpawn as Record<string, unknown>).parent_thread_id;
  return typeof nested === "string" ? nested : undefined;
}

function currentSessionForInput(
  input: SearchSessionsInput
): CallerSession | undefined {
  if (input.callerSession) {
    return input.callerSession;
  }
  if (
    process.env.AGENT_SESSION_SEARCH_CALLER_SOURCE &&
    process.env.AGENT_SESSION_SEARCH_CALLER_SESSION_ID
  ) {
    return {
      source: process.env.AGENT_SESSION_SEARCH_CALLER_SOURCE,
      sessionId: process.env.AGENT_SESSION_SEARCH_CALLER_SESSION_ID,
    };
  }
  if (process.env.CODEX_THREAD_ID) {
    return {
      source: "codex",
      sessionId: process.env.CODEX_THREAD_ID,
    };
  }
  return undefined;
}

function toEvidenceGroups(
  results: SearchResult[],
  input: SearchSessionsInput
): SearchEvidenceGroup[] {
  const groups = new Map<string, SearchEvidenceGroup>();

  for (const result of results) {
    const key = `${result.source}\0${result.path}`;
    const existing = groups.get(key);
    if (existing) {
      existing.hitCount += 1;
      addUniqueValues(existing.matchedPatterns, resultPatterns(result));
      addUniqueValues(existing.matchedQueries, resultQueries(result));
      addEvidenceSnippet(existing, result);
      continue;
    }

    const sessionId = sessionIdFromPath(result.path);
    const group: SearchEvidenceGroup = {
      source: result.source,
      root: result.root,
      path: result.path,
      ...(sessionId ? { sessionId } : {}),
      hitCount: 1,
      matchedQueries: resultQueries(result),
      matchedPatterns: resultPatterns(result),
      snippets: [],
      more: evidenceFollowup(input, result.source, result.path),
    };
    addEvidenceSnippet(group, result);
    groups.set(key, group);
  }

  return Array.from(groups.values());
}

function evidenceFollowup(
  input: SearchSessionsInput,
  source: SearchResult["source"],
  path: string
): SearchCandidate["more"] {
  return {
    evidence: {
      query: input.query,
      ...(input.queries ? { queries: input.queries } : {}),
      sources: [source],
      resultsDisplayMode: "evidence",
      paths: [path],
    },
  };
}

function addEvidenceSnippet(group: SearchEvidenceGroup, result: SearchResult) {
  if (group.snippets.length >= EVIDENCE_GROUP_SNIPPET_LIMIT) {
    return;
  }
  group.snippets.push({
    content: truncateUtf8(result.content, PREVIEW_MAX_BYTES),
    ...(result.line !== undefined ? { line: result.line } : {}),
    ...(result.pattern ? { pattern: result.pattern } : {}),
    ...(result.query ? { query: result.query } : {}),
  });
}

function addUnique(values: string[], value: string | undefined) {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

function addUniqueValues(values: string[], incoming: string[]) {
  for (const value of incoming) {
    addUnique(values, value);
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function resultPatterns(result: SearchResult) {
  return result.patterns?.length
    ? result.patterns
    : result.pattern
      ? [result.pattern]
      : [];
}

function resultQueries(result: SearchResult) {
  return result.queries?.length
    ? result.queries
    : result.query
      ? [result.query]
      : [];
}

function sessionIdFromPath(path: string) {
  return basename(path).match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
  )?.[0];
}

function effectiveSearchInput(input: SearchSessionsInput): SearchSessionsInput {
  if (!input.groupCandidates) {
    return input;
  }
  const followup = input.groupCandidates;
  return {
    query: followup.query,
    ...(followup.queries ? { queries: followup.queries } : {}),
    ...(followup.operationalContext !== undefined
      ? { operationalContext: followup.operationalContext }
      : {}),
    ...(followup.callerSession !== undefined
      ? { callerSession: followup.callerSession }
      : {}),
    ...(followup.sources ? { sources: followup.sources } : {}),
    resultsDisplayMode: "candidates",
    groupCandidates: followup,
    ...(followup.paths ? { paths: followup.paths } : {}),
    ...(followup.days !== undefined ? { days: followup.days } : {}),
    ...(followup.workspace !== undefined
      ? { workspace: followup.workspace }
      : {}),
    ...(followup.maxPatterns !== undefined
      ? { maxPatterns: followup.maxPatterns }
      : {}),
    ...(followup.maxResultsPerSource !== undefined
      ? { maxResultsPerSource: followup.maxResultsPerSource }
      : {}),
    ...(followup.context !== undefined ? { context: followup.context } : {}),
    ...(input.debug !== undefined ? { debug: input.debug } : {}),
  };
}

function searchMetadata({
  resultsDisplayMode,
  resultsShape,
  backendMetadata,
  maxPatterns,
  maxResultsPerSource,
  candidateGroupLeadLimit,
  unscopedEvidenceDefaultCap,
  filters,
}: {
  resultsDisplayMode: SearchSessionsOutput["resultsDisplayMode"];
  resultsShape: ResultsShape;
  backendMetadata: SearchBackendMetadata[];
  maxPatterns: number | undefined;
  maxResultsPerSource: number | undefined;
  candidateGroupLeadLimit: number | undefined;
  unscopedEvidenceDefaultCap: number | undefined;
  filters: SearchSessionsOutput["metadata"]["filters"];
}): SearchSessionsOutput["metadata"] {
  return {
    contractVersion: "progressive-evidence-groups.v2",
    resultsDisplayMode,
    resultsShape,
    backend: summarizeBackendMetadata(backendMetadata),
    ...(filters === undefined ? {} : { filters }),
    limits: {
      ...(maxPatterns !== undefined ? { maxPatterns } : {}),
      ...(maxResultsPerSource !== undefined ? { maxResultsPerSource } : {}),
      ...(candidateGroupLeadLimit !== undefined
        ? { candidateGroupLeadLimit }
        : {}),
      ...(unscopedEvidenceDefaultCap !== undefined
        ? { unscopedEvidenceDefaultCap }
        : {}),
    },
    countSemantics: {
      relation: "eq means exact; gte means lower bound",
      assignedCandidateCount:
        "canonical candidates assigned to the group before lead slicing",
      hitCount: "physical matched lines, not pattern-line pairs",
      shownLeadCount: "leads included in this response",
    },
  };
}

function summarizeBackendMetadata(
  metadata: SearchBackendMetadata[]
): SearchBackendMetadata {
  const fallback = metadata.find(
    (item) => item.mode === "sequential_grep_fallback"
  );
  if (fallback) {
    return fallback;
  }
  if (metadata.some((item) => item.mode === "multi_grep")) {
    return { mode: "multi_grep" };
  }
  if (metadata.some((item) => item.mode === "sequential_grep")) {
    return { mode: "sequential_grep" };
  }
  return { mode: "custom" };
}

function expandPatternPlans(input: SearchSessionsInput, config: ConfigFile) {
  const hasPlannedQueries = Boolean(input.queries?.length);
  const queries = hasPlannedQueries ? input.queries! : [input.query];
  const plans: PatternPlan[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const planned = planQueryPatterns(query, { synonyms: config.synonyms });
    const queryPlans = hasPlannedQueries
      ? [
          {
            id: "p0",
            query,
            pattern: query,
            provenance: "full_phrase" as const,
            initialGroup: "exact_or_structured" as const,
          },
          ...planned,
        ]
      : planned;
    for (const plan of queryPlans) {
      if (seen.has(plan.pattern)) {
        continue;
      }
      seen.add(plan.pattern);
      plans.push({
        ...plan,
        id: `p${plans.length + 1}`,
      });
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
  now?: () => number;
};

export function createSessionSearch(
  options: CreateSessionSearchOptions = {}
): SessionSearch {
  return new CoordinatedSessionSearch(options);
}

function errorMessage(error: unknown) {
  try {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  } catch {
    return "Unknown error";
  }
}

function isBackendFailureWarning(warning: { code: string }) {
  return (
    warning.code === "fff_backend_error" ||
    warning.code === "fff_backend_timeout"
  );
}

function maybeCapResults(
  results: SearchResult[],
  maxResults: number | undefined
) {
  return maxResults === undefined ? results : results.slice(0, maxResults);
}

function shouldDeferBackendCap(
  source: ResolvedSessionSource,
  input: SearchSessionsInput
) {
  return Boolean(
    input.paths?.length ||
    input.days !== undefined ||
    input.workspace !== undefined ||
    hasRestrictiveInclude(source.include)
  );
}

function hasRestrictiveInclude(include: string[] | undefined) {
  return Boolean(include?.length && !include.includes("*"));
}

const DEFAULT_FFF_TIMEOUT_MS = 15_000;
const DEFAULT_UNSCOPED_EVIDENCE_MAX_RESULTS_PER_SOURCE = 20;
const EVIDENCE_CONTENT_MAX_BYTES = 8_192;
const EVIDENCE_GROUP_SNIPPET_LIMIT = 3;
const PREVIEW_MAX_BYTES = 500;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RECENCY_SCORE_WEIGHT = 2;
const PROJECT_SCORE_BOOST = 2;
const SESSION_METADATA_MAX_BYTES = 64 * 1024;
const SESSION_METADATA_MAX_LINES = 40;
const PROJECT_CONTEXT_FIELDS = ["cwd", "projectRoot", "workspace", "repo"];
const GENERIC_PROJECT_TOKENS = new Set([
  "build",
  "code",
  "data",
  "dist",
  "home",
  "node",
  "node_modules",
  "project",
  "projects",
  "repo",
  "repos",
  "session",
  "sessions",
  "src",
  "test",
  "tests",
  "tmp",
  "user",
  "users",
  "var",
  "workspace",
  "workspaces",
]);

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
