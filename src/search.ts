import type {
  RankingProjectMatch,
  RankingRecencyBucket,
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
} from "./types.js";
import { open, realpath, stat } from "node:fs/promises";
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
import { rewriteQueryPatterns } from "./query-rewriter.js";
import { basename, dirname, isAbsolute, join, normalize, sep } from "node:path";

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
    const searchConfig = await loadSearchConfig(this.options.configPath);
    const resolvedRoots = await resolveSessionRoots({
      sources: input.sources,
      configPath: this.options.configPath,
      config: searchConfig,
      defaultRoots: this.options.defaultRoots,
    });
    const resultsDisplayMode =
      input.resultsDisplayMode ?? (input.debug ? "debug" : "candidates");
    const defaults = validatedDefaults(searchConfig.defaults);
    const maxPatterns = input.maxPatterns ?? defaults.maxPatterns;
    const isUnscopedEvidenceRequest =
      resultsDisplayMode === "evidence" && !input.paths?.length;
    const isDefaultUnscopedEvidenceCapApplied =
      isUnscopedEvidenceRequest &&
      input.maxResultsPerSource === undefined &&
      defaults.maxResultsPerSource === undefined;
    const maxResultsPerSource =
      input.maxResultsPerSource ??
      defaults.maxResultsPerSource ??
      (isUnscopedEvidenceRequest
        ? DEFAULT_UNSCOPED_EVIDENCE_MAX_RESULTS_PER_SOURCE
        : undefined);
    const requestMaxResultsPerSource = input.paths?.length
      ? input.maxResultsPerSource
      : maxResultsPerSource;
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
      this.options.createBackend ?? this.defaultBackendPool!.createBackend;
    let unscopedEvidenceCapReached = false;

    const sourceSlots = await Promise.all(
      searchedSources.map((source, index) =>
        searchSourceSlot({
          index,
          source,
          createBackend,
          input,
          expandedPatterns,
          requestMaxResultsPerSource,
          context,
          queryByPattern,
          isDefaultUnscopedEvidenceCapApplied,
          maxResultsPerSource,
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
      unscopedEvidenceCapReached =
        unscopedEvidenceCapReached || slot.unscopedEvidenceCapReached;
    }

    if (unscopedEvidenceCapReached) {
      warnings.push({
        code: "broad_evidence_capped",
        message: `Unscoped evidence searches are capped at ${DEFAULT_UNSCOPED_EVIDENCE_MAX_RESULTS_PER_SOURCE} results per source. Use candidates first, then pass a candidate more.evidence payload or --path for focused evidence.`,
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
      });
    }

    const filteredResults = input.paths?.length
      ? rawResults.filter((result) => input.paths?.includes(result.path))
      : rawResults;
    const { results, resultsShape, rankingDebug } = await shapeResults(
      filteredResults,
      input,
      resultsDisplayMode
    );
    const shouldIncludeDebug = input.debug || resultsDisplayMode === "debug";

    return {
      query: input.query,
      resultsDisplayMode,
      resultsShape,
      expandedPatterns,
      searchedSources,
      warnings,
      results,
      ...(shouldIncludeDebug
        ? {
            debug: {
              input,
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
  isDefaultUnscopedEvidenceCapApplied: boolean;
  maxResultsPerSource: number | undefined;
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
  isDefaultUnscopedEvidenceCapApplied,
  maxResultsPerSource,
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
    };
  }

  const warnings: SearchWarning[] = [];
  const results: SearchResult[] = [];
  let backend: SessionSearchBackend | undefined;
  let status: ResolvedSessionSource["status"] = "ok";
  let warning: string | undefined;
  let failed = false;
  let unscopedEvidenceCapReached = false;

  try {
    backend = await createBackend(source);
    const backendInput: SessionSearchBackendInput = {
      patterns: expandedPatterns,
      maxResults: shouldDeferBackendCap(source, input)
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
    warnings.push(...output.warnings);
    const canonicalResults = await Promise.all(
      output.results.map((result) => canonicalizeSearchResult(result, source))
    );
    const sourceResults = maybeCapResults(
      canonicalResults.filter((result) =>
        resultMatchesSourceFilters(result, source, input)
      ),
      requestMaxResultsPerSource
    )
      .map(truncateEvidenceResult)
      .map((result) =>
        result.pattern
          ? {
              ...result,
              query: queryByPattern.get(result.pattern),
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
  };
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
  resultsDisplayMode: SearchSessionsOutput["resultsDisplayMode"]
): Promise<{
  results: SearchSessionsOutput["results"];
  resultsShape: ResultsShape;
  rankingDebug?: SearchSessionsDebug["ranking"];
}> {
  if (resultsDisplayMode === "candidates") {
    const { candidates, ranking } = await toCandidates(results, input);
    return {
      results: candidates,
      resultsShape: "candidates",
      ...(input.debug ? { rankingDebug: { candidates: ranking } } : {}),
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
  ranking: SearchCandidateRankingDebug[];
}> {
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
      more: evidenceFollowup(input, result.source, result.path),
    });
  }

  return orderCandidates(
    Array.from(candidates.values()),
    await projectSignalsFromOperationalContext(input.operationalContext)
  );
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

async function orderCandidates(
  candidates: SearchCandidate[],
  projectSignals: ProjectSignals
): Promise<{
  candidates: SearchCandidate[];
  ranking: SearchCandidateRankingDebug[];
}> {
  const ranked = await Promise.all(
    candidates.map(async (candidate, originalIndex) => {
      const mtimeMs = await candidateMtimeMs(candidate.path);
      const recencyBucket = recencyBucketForMtime(mtimeMs);
      const recencyScore = recencyPoints(recencyBucket);
      const densityScore = densityPoints(candidate.hitCount);
      const projectMatch = await projectMatchForCandidate(
        candidate,
        projectSignals
      );
      const projectScore = projectPoints(projectMatch);
      return {
        candidate,
        originalIndex,
        mtimeMs,
        recencyBucket,
        recencyPoints: recencyScore,
        densityPoints: densityScore,
        projectMatch,
        projectPoints: projectScore,
        score:
          recencyScore * RECENCY_SCORE_WEIGHT + densityScore + projectScore,
        current: isCurrentCodexCandidate(candidate),
      };
    })
  );

  ranked.sort(compareRankedCandidates);
  return {
    candidates: ranked.map((rank) => rank.candidate),
    ranking: ranked.map(toCandidateRankingDebug),
  };
}

function compareRankedCandidates(a: RankedCandidate, b: RankedCandidate) {
  return (
    Number(a.current) - Number(b.current) ||
    b.score - a.score ||
    b.candidate.hitCount - a.candidate.hitCount ||
    (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0) ||
    a.originalIndex - b.originalIndex
  );
}

function toCandidateRankingDebug(
  ranked: RankedCandidate,
  index: number
): SearchCandidateRankingDebug {
  return {
    rank: index + 1,
    source: ranked.candidate.source,
    path: ranked.candidate.path,
    ...(ranked.candidate.sessionId
      ? { sessionId: ranked.candidate.sessionId }
      : {}),
    hitCount: ranked.candidate.hitCount,
    originalIndex: ranked.originalIndex,
    isCurrentSession: ranked.current,
    ...(ranked.mtimeMs !== undefined ? { mtimeMs: ranked.mtimeMs } : {}),
    recencyBucket: ranked.recencyBucket,
    recencyPoints: ranked.recencyPoints,
    densityPoints: ranked.densityPoints,
    projectMatch: ranked.projectMatch,
    projectPoints: ranked.projectPoints,
    score: ranked.score,
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
  candidate: SearchCandidate
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

function mayContainSessionMetadata(candidate: SearchCandidate) {
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

async function canonicalProjectPath(value: string) {
  const expanded =
    value === "~" || value.startsWith(`~${sep}`)
      ? `${process.env.HOME ?? ""}${value.slice(1)}`
      : value;
  try {
    return await realpath(expanded);
  } catch {
    return normalize(expanded);
  }
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

function isCurrentCodexCandidate(candidate: SearchCandidate) {
  return (
    candidate.source === "codex" &&
    candidate.sessionId !== undefined &&
    process.env.CODEX_THREAD_ID === candidate.sessionId
  );
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
      addUnique(existing.matchedPatterns, result.pattern);
      addUnique(existing.matchedQueries, result.query);
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
      matchedQueries: result.query ? [result.query] : [],
      matchedPatterns: result.pattern ? [result.pattern] : [],
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
  return Boolean(input.paths?.length || hasRestrictiveInclude(source.include));
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
