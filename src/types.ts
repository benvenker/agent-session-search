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

export type SearchSessionsOutput = {
  query: string;
  resultsDisplayMode: ResultsDisplayMode;
  expandedPatterns: string[];
  searchedSources: SearchedSource[];
  warnings: SearchWarning[];
  results: Array<SearchResult | SearchCandidate>;
  debug?: unknown;
};

export type SessionSearch = {
  searchSessions(input: SearchSessionsInput): Promise<SearchSessionsOutput>;
};
