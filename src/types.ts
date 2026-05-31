export type BuiltinSource =
  | "codex"
  | "claude"
  | "pi"
  | "cursor"
  | "hermes"
  | "pool";
export type SourceName = BuiltinSource | (string & {});

export type SearchSessionsInput = {
  query: string;
  queries?: string[];
  operationalContext?: unknown;
  sources?: SourceName[] | "all";
  resultsDisplayMode?: ResultsDisplayMode;
  paths?: string[];
  maxPatterns?: number;
  maxResultsPerSource?: number;
  context?: number;
  debug?: boolean;
};

export type ResultsDisplayMode = "candidates" | "evidence" | "debug";
export type ResultsShape = "candidates" | "evidence_groups" | "evidence_hits";

export type SearchedSource = {
  name: SourceName;
  root: string;
  status: "ok" | "missing" | "failed";
  warning?: string;
};

export type SearchWarning = {
  source?: SourceName;
  root?: string;
  code: string;
  message: string;
};

export type SearchResult = {
  source: SourceName;
  root: string;
  path: string;
  line?: number;
  content: string;
  query?: string;
  pattern?: string;
  context?: string[];
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
  originalIndex: number;
  isCurrentSession: boolean;
  mtimeMs?: number;
  recencyBucket: RankingRecencyBucket;
  recencyPoints: number;
  densityPoints: number;
  projectMatch: RankingProjectMatch;
  projectPoints: number;
  score: number;
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
  expandedPatterns: string[];
  searchedSources: SearchedSource[];
  warnings: SearchWarning[];
  results: Array<SearchResult | SearchCandidate | SearchEvidenceGroup>;
  debug?: SearchSessionsDebug;
};

export type SessionSearch = {
  searchSessions(input: SearchSessionsInput): Promise<SearchSessionsOutput>;
  close?(): Promise<void>;
};
