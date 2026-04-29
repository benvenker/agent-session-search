export type BuiltinSource = "codex" | "claude" | "pi" | "cursor" | "hermes";
export type SourceName = BuiltinSource | (string & {});

export type SearchSessionsInput = {
  query: string;
  sources?: SourceName[] | "all";
  maxPatterns?: number;
  maxResultsPerSource?: number;
  context?: number;
  debug?: boolean;
};

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
  pattern?: string;
  context?: string[];
};

export type SearchSessionsOutput = {
  query: string;
  expandedPatterns: string[];
  searchedSources: SearchedSource[];
  warnings: SearchWarning[];
  results: SearchResult[];
  debug?: unknown;
};

export type SessionSearch = {
  searchSessions(input: SearchSessionsInput): Promise<SearchSessionsOutput>;
};
