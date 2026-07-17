import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupCandidatesFingerprint } from "../src/followup.js";
import { createSessionSearch } from "../src/search.js";
import {
  SearchSessionsInputError,
  parseSearchSessionsInput,
  runSearchSessionsTool,
  searchSessionsInputSchema,
} from "../src/tool.js";
import type { SessionSearch } from "../src/types.js";
import { groupCandidates } from "./support/followup.js";

describe("search_sessions tool boundary", () => {
  it("uses a restart-stable group follow-up fingerprint", () => {
    expect(
      groupCandidatesFingerprint({
        query: "auth token timeout",
        sources: ["codex"],
        resultsDisplayMode: "candidates",
        planFingerprint: "gcp1:test",
        group: {
          id: "exact_or_structured",
          priority: 0,
          patternIds: ["p1"],
        },
        offset: 0,
        limit: 10,
      })
    ).toBe("gcf1:52e25b6aeccbeaff");
  });

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
            contractVersion: "progressive-evidence-groups.v2",
            resultsDisplayMode,
            resultsShape:
              resultsDisplayMode === "evidence"
                ? input.paths?.length
                  ? "evidence_hits"
                  : "evidence_groups"
                : resultsDisplayMode === "debug"
                  ? "evidence_hits"
                  : "candidates",
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
        contractVersion: "progressive-evidence-groups.v2",
        resultsDisplayMode: "evidence",
        resultsShape: "evidence_hits",
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
      groupCandidates: groupCandidates({
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
      }),
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

  it("normalizes exact top-level group candidate follow-up echoes", () => {
    const followup = groupCandidates({
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
    });

    const parsed = parseSearchSessionsInput(
      searchSessionsInputSchema.parse(followup)
    );

    expect(parsed).toEqual({
      query: "auth token timeout",
      sources: ["codex"],
      resultsDisplayMode: "candidates",
      groupCandidates: followup,
    });
  });

  it("rejects edited top-level group candidate follow-up modes", () => {
    const followup = groupCandidates({
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
    });

    expect(() =>
      parseSearchSessionsInput(
        searchSessionsInputSchema.parse({
          ...followup,
          resultsDisplayMode: "evidence",
        })
      )
    ).toThrow(
      expect.objectContaining({
        code: "invalid_group_followup",
        invalidField: "resultsDisplayMode",
      })
    );
  });

  it("rejects malformed group follow-up payloads with a teaching error", async () => {
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
          query: "auth token timeout",
          resultsDisplayMode: "candidates",
          planFingerprint: "gcp1:test",
          fingerprint: "gcf1:test",
          offset: 0,
          limit: 10,
        },
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "groupCandidates.group",
      correctedShape: {
        groupCandidates: {
          resultsDisplayMode: "candidates",
          group: {
            id: "exact_or_structured",
            priority: 0,
            patternIds: ["p1"],
          },
          offset: 0,
          limit: 10,
        },
      },
    } satisfies Partial<SearchSessionsInputError>);
  });

  it("replays prepared group follow-ups through the public tool boundary", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot, include: ["*.jsonl"] }],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push({ source: source.name, input });
            return {
              warnings: [],
              results: Array.from({ length: 8 }, (_, index) => ({
                source: source.name,
                root: source.root,
                path: join(source.root, `candidate-${index + 1}.jsonl`),
                line: 1,
                content: `candidate ${index + 1}`,
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const firstPage = await runSearchSessionsTool(search, {
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      maxPatterns: 3,
      maxResultsPerSource: 5,
    });
    const exactGroup = firstPage.results[0] as any;

    calls.length = 0;
    await runSearchSessionsTool(search, {
      query: "auth token timeout",
      groupCandidates: exactGroup.more.groupCandidates,
    });

    expect(calls).toEqual([
      {
        source: "codex",
        input: {
          patterns: ["auth token timeout", "auth token", "token timeout"],
          maxResults: undefined,
          context: undefined,
          include: ["*.jsonl"],
        },
      },
    ]);
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
        groupCandidates: groupCandidates({
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
        }),
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "groupCandidates.query",
      correctedShape: {
        groupCandidates: {
          resultsDisplayMode: "candidates",
          group: {
            id: "exact_or_structured",
            priority: 0,
            patternIds: ["p1"],
          },
          offset: 0,
          limit: 10,
        },
      },
    } satisfies Partial<SearchSessionsInputError>);
  });

  it("rejects edited group follow-up fingerprints", async () => {
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
          ...groupCandidates({
            query: "auth token timeout",
            sources: ["codex"],
            resultsDisplayMode: "candidates",
            group: {
              id: "exact_or_structured",
              priority: 0,
              patternIds: ["p1"],
            },
            offset: 0,
            limit: 10,
          }),
          offset: 1,
        },
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "groupCandidates.fingerprint",
    });
  });

  it("rejects conflicting top-level group follow-up queries and sources", async () => {
    const search: SessionSearch = {
      async searchSessions() {
        throw new Error("search should not run for invalid follow-ups");
      },
    };
    const followup = groupCandidates({
      query: "auth token timeout",
      queries: ["auth token", "timeout"],
      sources: ["codex"],
      resultsDisplayMode: "candidates",
      group: {
        id: "exact_or_structured",
        priority: 0,
        patternIds: ["p1"],
      },
      offset: 0,
      limit: 10,
    });

    await expect(
      runSearchSessionsTool(search, {
        query: "auth token timeout",
        queries: ["timeout", "auth token"],
        resultsDisplayMode: "candidates",
        groupCandidates: followup,
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "queries",
    });

    await expect(
      runSearchSessionsTool(search, {
        query: "auth token timeout",
        sources: ["claude"],
        resultsDisplayMode: "candidates",
        groupCandidates: followup,
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "sources",
    });
  });

  it("rejects conflicting top-level group follow-up search caps", async () => {
    const search: SessionSearch = {
      async searchSessions() {
        throw new Error("search should not run for invalid follow-ups");
      },
    };
    const followup = groupCandidates({
      query: "auth token timeout",
      operationalContext: { repo: "agent-session-search" },
      sources: ["codex"],
      resultsDisplayMode: "candidates",
      maxPatterns: 3,
      maxResultsPerSource: 5,
      context: 2,
      group: {
        id: "exact_or_structured",
        priority: 0,
        patternIds: ["p1"],
      },
      offset: 0,
      limit: 5,
    });

    await expect(
      runSearchSessionsTool(search, {
        query: "auth token timeout",
        operationalContext: { repo: "other" },
        resultsDisplayMode: "candidates",
        groupCandidates: followup,
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "operationalContext",
    });

    await expect(
      runSearchSessionsTool(search, {
        query: "auth token timeout",
        maxPatterns: 4,
        resultsDisplayMode: "candidates",
        groupCandidates: followup,
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "maxPatterns",
    });

    await expect(
      runSearchSessionsTool(search, {
        query: "auth token timeout",
        maxResultsPerSource: 10,
        resultsDisplayMode: "candidates",
        groupCandidates: followup,
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "maxResultsPerSource",
    });

    await expect(
      runSearchSessionsTool(search, {
        query: "auth token timeout",
        context: 4,
        resultsDisplayMode: "candidates",
        groupCandidates: followup,
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "context",
    });
  });
});
