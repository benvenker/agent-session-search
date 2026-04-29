import type { SearchSessionsInput, SearchSessionsOutput, SessionSearch } from "./types.js";
import {
  resolveSessionRoots,
  type ResolveSessionRootsInput,
  type SessionRootConfig,
} from "./roots.js";

export class StubSessionSearch implements SessionSearch {
  constructor(private readonly options: CreateSessionSearchOptions = {}) {}

  async searchSessions(input: SearchSessionsInput): Promise<SearchSessionsOutput> {
    const resolvedRoots = await resolveSessionRoots({
      sources: input.sources,
      configPath: this.options.configPath,
      defaultRoots: this.options.defaultRoots,
    });

    return {
      query: input.query,
      expandedPatterns: [input.query],
      searchedSources: resolvedRoots.sources,
      warnings: [
        ...resolvedRoots.warnings,
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

export type CreateSessionSearchOptions = Pick<ResolveSessionRootsInput, "configPath"> & {
  defaultRoots?: SessionRootConfig[];
};

export function createSessionSearch(options: CreateSessionSearchOptions = {}): SessionSearch {
  return new StubSessionSearch(options);
}
