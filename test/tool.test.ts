import { describe, expect, it } from "vitest";
import {
  SearchSessionsInputError,
  runSearchSessionsTool,
  searchSessionsInputSchema,
} from "../src/tool.js";
import type { SessionSearch } from "../src/types.js";

describe("search_sessions tool boundary", () => {
  it("passes validated input to the shared search library", async () => {
    const calls: unknown[] = [];
    const search: SessionSearch = {
      async searchSessions(input) {
        calls.push(input);
        const resultsDisplayMode = input.resultsDisplayMode ?? "candidates";
        return {
          query: input.query,
          resultsDisplayMode,
          resultsShape:
            resultsDisplayMode === "evidence"
              ? input.paths?.length
                ? "evidence_hits"
                : "evidence_groups"
              : resultsDisplayMode === "debug"
                ? "evidence_hits"
                : "candidates",
          expandedPatterns: [input.query],
          metadata: {
            contractVersion: "progressive-evidence-groups.v1",
            backend: { mode: "custom" },
            limits: {},
            countSemantics: {
              relation: "eq means exact; gte means lower bound",
              assignedCandidateCount:
                "canonical candidates assigned to the group before lead slicing",
              hitCount: "physical matched lines, not pattern-line pairs",
              shownLeadCount: "leads included in this response",
            },
          },
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
      resultsDisplayMode: "evidence",
      paths: ["/Users/ben/.codex/sessions/session.jsonl"],
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
        resultsDisplayMode: "evidence",
        paths: ["/Users/ben/.codex/sessions/session.jsonl"],
        maxPatterns: 3,
        maxResultsPerSource: 10,
        context: 2,
        debug: true,
      },
    ]);
    expect(result).toEqual({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      resultsShape: "evidence_hits",
      expandedPatterns: ["auth token timeout"],
      metadata: {
        contractVersion: "progressive-evidence-groups.v1",
        backend: { mode: "custom" },
        limits: {},
        countSemantics: {
          relation: "eq means exact; gte means lower bound",
          assignedCandidateCount:
            "canonical candidates assigned to the group before lead slicing",
          hitCount: "physical matched lines, not pattern-line pairs",
          shownLeadCount: "leads included in this response",
        },
      },
      searchedSources: [],
      warnings: [],
      results: [],
    });
  });

  it("accepts the structured group candidate follow-up shape", () => {
    const parsed = searchSessionsInputSchema.parse({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      groupCandidates: {
        query: "auth token timeout",
        sources: ["codex"],
        resultsDisplayMode: "candidates",
        group: {
          id: "exact_or_structured",
          priority: 0,
          patternIds: ["p1"],
        },
        offset: 3,
        limit: 10,
      },
    });

    expect(parsed.groupCandidates).toMatchObject({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      group: {
        id: "exact_or_structured",
        priority: 0,
        patternIds: ["p1"],
      },
      offset: 3,
      limit: 10,
    });
  });

  it("rejects inconsistent group follow-ups with a teaching error", async () => {
    const search: SessionSearch = {
      async searchSessions() {
        throw new Error("search should not run for invalid follow-ups");
      },
    };

    await expect(
      runSearchSessionsTool(search, {
        query: "auth token timeout",
        resultsDisplayMode: "candidates",
        groupCandidates: {
          query: "different query",
          sources: ["codex"],
          resultsDisplayMode: "candidates",
          group: {
            id: "exact_or_structured",
            priority: 0,
            patternIds: ["p1"],
          },
          offset: 0,
          limit: 10,
        },
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "groupCandidates.query",
      correctedShape: {
        resultsDisplayMode: "candidates",
        group: {
          id: "exact_or_structured",
          priority: 0,
          patternIds: ["p1"],
        },
        offset: 0,
        limit: 10,
      },
    } satisfies Partial<SearchSessionsInputError>);
  });
});
