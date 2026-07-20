import { describe, expect, it, vi } from "vitest";
import { runCassCompat } from "../src/cass-compat/run.js";
import type {
  SearchSessionsInput,
  SearchSessionsOutput,
  SessionSearch,
} from "../src/types.js";

describe("cass-compatible search", () => {
  it("claude_code restricts search to claude and is emitted as claude_code", async () => {
    let capturedInput: SearchSessionsInput | undefined;
    const sessionSearch: SessionSearch = {
      searchSessions: vi.fn(async (input) => {
        capturedInput = input;
        return candidateOutput("claude", "/sessions/claude.jsonl");
      }),
    };
    const searchModule = await import("../src/cass-compat/search.js");

    const completion = await runCassCompat(
      ["search", "--agent", "claude_code", "--robot", "--", "vitest"],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({
            createSessionSearch: () => sessionSearch,
          }),
      }
    );

    expect(capturedInput).toMatchObject({
      query: "vitest",
      sources: ["claude"],
      resultsDisplayMode: "candidates",
    });
    expect(JSON.parse(completion.stdout).hits[0]).toMatchObject({
      agent: "claude_code",
    });
    expect(completion).toMatchObject({ exitCode: 0, stderr: "" });
  });

  it("maps pi_agent and repeated known agents without broadening", async () => {
    const capturedInputs: SearchSessionsInput[] = [];
    const searchModule = await import("../src/cass-compat/search.js");
    const sessionSearch: SessionSearch = {
      searchSessions: vi.fn(async (input) => {
        capturedInputs.push(input);
        return candidateOutput("pi", "/sessions/pi.jsonl");
      }),
    };

    const completion = await runCassCompat(
      [
        "search",
        "--agent",
        "pi_agent",
        "--agent",
        "codex",
        "--agent",
        "pi_agent",
        "--",
        "vitest",
      ],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({
            createSessionSearch: () => sessionSearch,
          }),
      }
    );

    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0]?.sources).toEqual(["pi", "codex"]);
    expect(JSON.parse(completion.stdout).hits[0].agent).toBe("pi_agent");
  });

  it("unknown agent slug returns zero hits without constructing the backend", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const createSessionSearch = vi.fn<() => SessionSearch>();

    const completion = await runCassCompat(
      ["search", "--agent", "bogus", "--robot", "--", "vitest"],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({ createSessionSearch }),
      }
    );

    expect(completion).toEqual({
      stdout:
        '{\n  "query": "vitest",\n  "limit": 10,\n  "offset": 0,\n  "count": 0,\n  "total_matches": 0,\n  "hits": [],\n  "max_tokens": null,\n  "request_id": null,\n  "cursor": null,\n  "hits_clamped": false\n}\n',
      stderr:
        "Unsupported agent slug bogus. Accepted agent slugs: claude_code, codex, cursor, gemini, hermes, pi_agent.\n",
      exitCode: 0,
    });
    expect(createSessionSearch).not.toHaveBeenCalled();
  });

  it("passes days workspace and bounded overfetch directly to managed search", async () => {
    let capturedInput: SearchSessionsInput | undefined;
    const searchModule = await import("../src/cass-compat/search.js");
    const sessionSearch: SessionSearch = {
      searchSessions: vi.fn(async (input) => {
        capturedInput = input;
        return candidateOutput("codex", "/sessions/codex.jsonl");
      }),
    };

    const completion = await runCassCompat(
      [
        "search",
        "--limit",
        "7",
        "--days",
        "3",
        "--workspace",
        "/data/projects/agent-session-search",
        "--robot",
        "--",
        "literal query",
      ],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({
            createSessionSearch: () => sessionSearch,
          }),
      }
    );

    expect(capturedInput).toEqual({
      query: "literal query",
      resultsDisplayMode: "candidates",
      days: 3,
      workspace: "/data/projects/agent-session-search",
      maxResultsPerSource: 21,
    });
    expect(completion.exitCode).toBe(0);
  });

  it("uses the injected in-process session search factory exactly once", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const close = vi.fn(async () => undefined);
    const searchSessions = vi.fn(async () =>
      candidateOutput("codex", "/sessions/codex.jsonl")
    );
    const createSessionSearch = vi.fn(() => ({ searchSessions, close }));

    const completion = await runCassCompat(
      ["search", "--limit", "1", "--robot", "--", "vitest"],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({ createSessionSearch }),
      }
    );

    expect(completion.exitCode).toBe(0);
    expect(createSessionSearch).toHaveBeenCalledTimes(1);
    expect(searchSessions).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

function candidateOutput(
  source: "claude" | "pi" | "codex",
  path: string
): SearchSessionsOutput {
  return {
    query: "vitest",
    resultsDisplayMode: "candidates",
    resultsShape: "candidate_groups",
    metadata: {
      contractVersion: "progressive-evidence-groups.v2",
      resultsDisplayMode: "candidates",
      resultsShape: "candidate_groups",
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
    expandedPatterns: ["vitest"],
    searchedSources: [{ name: source, root: "/sessions", status: "ok" }],
    warnings: [],
    results: [
      {
        id: "exact_or_structured",
        priority: 0,
        label: "Exact",
        guidance: "",
        patternIds: ["p1"],
        assignedCandidateCount: { value: 1, relation: "eq" },
        hitCount: { value: 1, relation: "eq" },
        shownLeadCount: 1,
        hasMore: false,
        leads: [
          {
            source,
            root: "/sessions",
            path,
            preview: "vitest preview",
            hitCount: 1,
            matchedQueries: ["vitest"],
            matchedPatterns: ["vitest"],
            more: {
              evidence: {
                query: "vitest",
                sources: [source],
                resultsDisplayMode: "evidence",
                paths: [path],
              },
            },
          },
        ],
      },
    ],
  };
}
