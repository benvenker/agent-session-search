export type BuiltinSource =
  | "codex"
  | "claude"
  | "pi"
  | "cursor"
  | "hermes"
  | "gemini"
  | "pool";
export type SourceName = BuiltinSource | (string & {});

export type SearchSessionsInput = {
  query: string;
  queries?: string[];
  operationalContext?: unknown;
  callerSession?: CallerSession;
  sources?: SourceName[] | "all";
  resultsDisplayMode?: ResultsDisplayMode;
  groupCandidates?: GroupCandidatesFollowupInput;
  paths?: string[];
  days?: number;
  workspace?: string;
  maxPatterns?: number;
  maxResultsPerSource?: number;
  context?: number;
  debug?: boolean;
};

export type CallerSession = {
  source: SourceName;
  sessionId: string;
};

export type ResultsDisplayMode = "candidates" | "evidence" | "debug";
export type ResultsShape =
  | "candidates"
  | "candidate_groups"
  | "evidence_groups"
  | "evidence_hits";

export type MatchGroupId =
  | "exact_or_structured"
  | "phrase_or_adjacent_terms"
  | "multi_term_coverage"
  | "distinctive_term"
  | "loose_fallback";

export type PatternProvenance =
  | "command"
  | "quoted_phrase"
  | "error_fragment"
  | "package_name"
  | "file_path"
  | "pull_request_reference"
  | "id"
  | "symbol_variant"
  | "full_phrase"
  | "adjacent_terms"
  | "natural_term"
  | "configured_synonym";

export type PatternPlan = {
  id: string;
  query: string;
  pattern: string;
  provenance: PatternProvenance;
  initialGroup: MatchGroupId;
};

export type CountRelation = "eq" | "gte";

export type CountWithRelation = {
  value: number;
  relation: CountRelation;
};

export type RecommendedAction = string & {};

export type GroupMembership = {
  id: MatchGroupId;
  priority: number;
  patternIds: string[];
};

export type GroupCandidatesFollowupInput = {
  query: string;
  queries?: string[];
  operationalContext?: unknown;
  callerSession?: CallerSession;
  sources?: SourceName[] | "all";
  resultsDisplayMode: "candidates";
  paths?: string[];
  days?: number;
  workspace?: string;
  maxPatterns?: number;
  maxResultsPerSource?: number;
  context?: number;
  planFingerprint: string;
  fingerprint: string;
  group: {
    id: MatchGroupId;
    priority: number;
    patternIds: string[];
  };
  offset: number;
  limit: number;
};

export type CandidateGroup = {
  id: MatchGroupId;
  priority: number;
  path?: never;
  label: string;
  guidance: string;
  patternIds: string[];
  assignedCandidateCount: CountWithRelation;
  hitCount: CountWithRelation;
  shownLeadCount: number;
  hasMore: boolean;
  leads: SearchCandidate[];
  more?: {
    groupCandidates: GroupCandidatesFollowupInput;
  };
};

export type SearchWarningCode =
  | "all_sources_failed"
  | "broad_evidence_capped"
  | "fff_multi_grep_unavailable"
  | "fff_multi_grep_probe_failed"
  | "filters_removed_all_results"
  | "source_cleanup_failed"
  | "source_missing"
  | "source_root_missing"
  | "source_search_failed"
  | (string & {});

export type SearchedSource = {
  name: SourceName;
  root: string;
  status: "ok" | "missing" | "failed";
  warning?: string;
};

export type SearchWarning = {
  source?: SourceName;
  root?: string;
  code: SearchWarningCode;
  message: string;
  recommendedAction?: RecommendedAction;
};

export type TeachingErrorCode = "invalid_group_followup";

export type SearchSessionsTeachingError = {
  code: TeachingErrorCode;
  invalidField: string;
  correctedShape: Record<string, unknown>;
};

export type SearchResult = {
  source: SourceName;
  root: string;
  path: string;
  line?: number;
  content: string;
  query?: string;
  queries?: string[];
  pattern?: string;
  patterns?: string[];
  context?: string[];
};

export type BackendMode =
  | "sequential_grep"
  | "multi_grep"
  | "sequential_grep_fallback"
  | "custom";

export type SearchBackendMetadata = {
  mode: BackendMode;
  fallbackReason?: string;
};

export type SearchSessionsMetadata = {
  contractVersion: "progressive-evidence-groups.v2";
  resultsDisplayMode: ResultsDisplayMode;
  resultsShape: ResultsShape;
  backend: SearchBackendMetadata;
  filters?: {
    days?: number;
    workspace?: string;
  };
  limits: {
    maxPatterns?: number;
    maxResultsPerSource?: number;
    candidateGroupLeadLimit?: number;
    unscopedEvidenceDefaultCap?: number;
  };
  countSemantics: {
    relation: "eq means exact; gte means lower bound";
    assignedCandidateCount: "canonical candidates assigned to the group before lead slicing";
    hitCount: "physical matched lines, not pattern-line pairs";
    shownLeadCount: "leads included in this response";
  };
};

export type SearchCandidate = {
  source: SourceName;
  root: string;
  path: string;
  sessionId?: string;
  line?: number;
  preview: string;
  hitCount: number;
  matchedQueries: string[];
  matchedPatterns: string[];
  strongestGroup?: GroupMembership;
  groupMemberships?: GroupMembership[];
  more: {
    evidence: {
      query: string;
      queries?: string[];
      sources: SourceName[];
      resultsDisplayMode: "evidence";
      paths: string[];
    };
  };
};

export type RankingRecencyBucket =
  | "lt_2h"
  | "lt_24h"
  | "lt_7d"
  | "lt_30d"
  | "older_or_missing";

export type RankingProjectMatch =
  | "none"
  | "path"
  | "repo_token"
  | "other_safe_metadata";

export type SearchCandidateRankingDebug = {
  rank: number;
  source: SourceName;
  path: string;
  sessionId?: string;
  hitCount: number;
  patternMatchCount: number;
  originalIndex: number;
  isCurrentSession: boolean;
  mtimeMs?: number;
  recencyBucket: RankingRecencyBucket;
  recencyPoints: number;
  densityPoints: number;
  projectMatch: RankingProjectMatch;
  projectPoints: number;
  score: number;
  strongestGroup?: GroupMembership;
  groupMemberships?: GroupMembership[];
};

export type SearchEvidenceSnippet = {
  line?: number;
  content: string;
  query?: string;
  pattern?: string;
};

export type SearchEvidenceGroup = {
  source: SourceName;
  root: string;
  path: string;
  sessionId?: string;
  hitCount: number;
  matchedQueries: string[];
  matchedPatterns: string[];
  snippets: SearchEvidenceSnippet[];
  more: SearchCandidate["more"];
};

export type SearchSessionsDebug = {
  input: SearchSessionsInput;
  expandedPatterns: string[];
  ranking?: {
    candidates: SearchCandidateRankingDebug[];
  };
};

export type SearchSessionsOutput = {
  query: string;
  resultsDisplayMode: ResultsDisplayMode;
  resultsShape: ResultsShape;
  metadata: SearchSessionsMetadata;
  expandedPatterns: string[];
  searchedSources: SearchedSource[];
  warnings: SearchWarning[];
  results: Array<
    SearchResult | SearchCandidate | SearchEvidenceGroup | CandidateGroup
  >;
  debug?: SearchSessionsDebug;
};

export type SessionSearch = {
  searchSessions(input: SearchSessionsInput): Promise<SearchSessionsOutput>;
  close?(): Promise<void>;
};
