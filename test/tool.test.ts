import { describe, expect, it } from "vitest";
import { runSearchSessionsTool } from "../src/tool.js";
import type { SessionSearch } from "../src/types.js";

describe("search_sessions tool boundary", () => {
  it("passes validated input to the shared search library", async () => {
    const calls: unknown[] = [];
    const search: SessionSearch = {
      async searchSessions(input) {
        calls.push(input);
        return {
          query: input.query,
          expandedPatterns: [input.query],
          searchedSources: [],
          warnings: [],
          results: [],
        };
      },
    };

    const result = await runSearchSessionsTool(search, {
      query: "auth token timeout",
      queries: ["PR #227", "paper-cuts"],
      operationalContext: {
        cwd: "/Users/ben/code/poolside/poolside-studio",
        branch: "paper-cuts",
      },
      sources: ["codex", "claude"],
      maxPatterns: 3,
      maxResultsPerSource: 10,
      context: 2,
      debug: true,
    });

    expect(calls).toEqual([
      {
        query: "auth token timeout",
        queries: ["PR #227", "paper-cuts"],
        operationalContext: {
          cwd: "/Users/ben/code/poolside/poolside-studio",
          branch: "paper-cuts",
        },
        sources: ["codex", "claude"],
        maxPatterns: 3,
        maxResultsPerSource: 10,
        context: 2,
        debug: true,
      },
    ]);
    expect(result).toEqual({
      query: "auth token timeout",
      expandedPatterns: ["auth token timeout"],
      searchedSources: [],
      warnings: [],
      results: [],
    });
  });
});
