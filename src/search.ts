import type { SearchSessionsInput, SearchSessionsOutput, SessionSearch } from "./types.js";

export class StubSessionSearch implements SessionSearch {
  async searchSessions(input: SearchSessionsInput): Promise<SearchSessionsOutput> {
    return {
      query: input.query,
      expandedPatterns: [input.query],
      searchedSources: [],
      warnings: [
        {
          code: "not_implemented",
          message: "Search backend is not implemented yet.",
        },
      ],
      results: [],
      debug: input.debug
        ? {
            input,
          }
        : undefined,
    };
  }
}

export function createSessionSearch(): SessionSearch {
  return new StubSessionSearch();
}
