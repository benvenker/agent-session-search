import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runCassCompat } from "../src/cass-compat/run.js";
import type {
  CandidateGroup,
  SearchCandidate,
  SearchSessionsInput,
  SearchSessionsOutput,
  SessionSearch,
} from "../src/types.js";

// Copied verbatim from cm 0.2.12's cass hit consumer.
const cmCassHitSchema = z.object({
  source_path: z.string(),
  line_number: z.number(),
  agent: z.string(),
  snippet: z.string(),
  workspace: z.string().optional(),
  title: z.string().optional(),
  score: z.number().optional(),
  created_at: z.union([z.string(), z.number(), z.null()]).optional(),
  origin: z
    .object({
      kind: z.string(),
      host: z.string().optional(),
    })
    .optional(),
});

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

  it("every hit parses with cm 0.2.12's zod schema verbatim", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const sessionSearch: SessionSearch = {
      searchSessions: vi.fn(async () =>
        candidateOutput("codex", "/sessions/codex.jsonl", 42)
      ),
    };

    const completion = await runCassCompat(
      ["search", "--robot", "--", "vitest"],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({
            createSessionSearch: () => sessionSearch,
          }),
      }
    );
    const hits = JSON.parse(completion.stdout).hits as unknown[];

    expect(hits).toHaveLength(1);
    expect(hits.map((hit) => cmCassHitSchema.parse(hit))).toHaveLength(1);
  });

  it("missing lead line emits non-nullable line_number 1", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const sessionSearch: SessionSearch = {
      searchSessions: vi.fn(async () =>
        candidateOutput("codex", "/sessions/no-line.jsonl")
      ),
    };

    const completion = await runCassCompat(
      ["search", "--robot", "--", "vitest"],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({
            createSessionSearch: () => sessionSearch,
          }),
      }
    );
    const hit = JSON.parse(completion.stdout).hits[0] as unknown;

    expect(searchModule.CASS_SHIM_DEFAULT_LINE_NUMBER).toBe(1);
    expect(cmCassHitSchema.parse(hit).line_number).toBe(1);
    expect(typeof (hit as { line_number: unknown }).line_number).toBe("number");
  });

  it("flattens dedupes and limits candidates in contract order", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const output = candidateOutput("codex", "/sessions/template.jsonl");
    const template = output.results[0] as CandidateGroup;
    output.results = [
      candidateGroup(template, 1, [
        candidateLead(template, "codex", "/sessions/later.jsonl", "later"),
      ]),
      candidateGroup(template, 0, [
        candidateLead(template, "codex", "/sessions/first.jsonl", "first"),
        candidateLead(template, "codex", "/sessions/first.jsonl", "duplicate"),
        candidateLead(
          template,
          "claude",
          "/sessions/first.jsonl",
          "same path, other source"
        ),
        candidateLead(template, "codex", "/sessions/second.jsonl", "second"),
      ]),
    ];
    const sessionSearch: SessionSearch = {
      searchSessions: vi.fn(async () => output),
    };

    const completion = await runCassCompat(
      ["search", "--limit", "3", "--robot", "--", "vitest"],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({
            createSessionSearch: () => sessionSearch,
          }),
      }
    );
    const hits = JSON.parse(completion.stdout).hits as Array<{
      source_path: string;
      agent: string;
      snippet: string;
    }>;

    expect(hits).toEqual([
      expect.objectContaining({
        source_path: "/sessions/first.jsonl",
        agent: "codex",
        snippet: "first",
      }),
      expect.objectContaining({
        source_path: "/sessions/first.jsonl",
        agent: "claude_code",
        snippet: "same path, other source",
      }),
      expect.objectContaining({
        source_path: "/sessions/second.jsonl",
        agent: "codex",
        snippet: "second",
      }),
    ]);
  });

  it("stats each selected unique path once and grounds created_at", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const output = candidateOutput("codex", "/sessions/template.jsonl");
    const template = output.results[0] as CandidateGroup;
    output.results = [
      candidateGroup(template, 0, [
        candidateLead(template, "codex", "/sessions/one.jsonl", "one"),
        candidateLead(template, "codex", "/sessions/one.jsonl", "duplicate"),
        candidateLead(template, "codex", "/sessions/two.jsonl", "two"),
        candidateLead(template, "codex", "/sessions/ignored.jsonl", "ignored"),
      ]),
    ];
    const statPath = vi.fn(async (path: string) => {
      if (path === "/sessions/one.jsonl") return { mtimeMs: 1_234 };
      throw new Error("stat unavailable");
    });
    const options = {
      createSessionSearch: () => ({
        searchSessions: vi.fn(async () => output),
      }),
      statPath,
    };

    const completion = await runCassCompat(
      ["search", "--limit", "2", "--robot", "--", "vitest"],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler(options),
      }
    );
    const hits = JSON.parse(completion.stdout).hits as Array<{
      source_path: string;
      created_at?: number;
    }>;

    expect(statPath.mock.calls).toEqual([
      ["/sessions/one.jsonl"],
      ["/sessions/two.jsonl"],
    ]);
    expect(hits[0]).toMatchObject({
      source_path: "/sessions/one.jsonl",
      created_at: 1_234,
    });
    expect(hits[1]).toMatchObject({ source_path: "/sessions/two.jsonl" });
    expect(hits[1]).not.toHaveProperty("created_at");
  });

  it("emits the exact pretty cass outer envelope with a trailing newline", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const completion = await runCassCompat(
      ["search", "--limit", "2", "--robot", "--", "vitest"],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({
            createSessionSearch: () => ({
              searchSessions: vi.fn(async () =>
                candidateOutput("codex", "/sessions/codex.jsonl")
              ),
            }),
          }),
      }
    );
    const envelope = JSON.parse(completion.stdout);

    expect(Object.keys(envelope)).toEqual([
      "query",
      "limit",
      "offset",
      "count",
      "total_matches",
      "hits",
      "max_tokens",
      "request_id",
      "cursor",
      "hits_clamped",
    ]);
    expect(envelope).toMatchObject({
      query: "vitest",
      limit: 2,
      offset: 0,
      count: 1,
      total_matches: 1,
      max_tokens: null,
      request_id: null,
      cursor: null,
      hits_clamped: false,
    });
    expect(completion.stdout).toContain('\n  "hits": [\n');
    expect(completion.stdout.endsWith("\n")).toBe(true);
  });

  it("echoes requested workspace and otherwise omits it", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const handler = searchModule.createCassCompatSearchHandler({
      createSessionSearch: () => ({
        searchSessions: vi.fn(async () =>
          candidateOutput("codex", "/sessions/codex.jsonl")
        ),
      }),
    });

    const withWorkspace = await runCassCompat(
      [
        "search",
        "--workspace",
        "/data/projects/agent-session-search",
        "--robot",
        "--",
        "vitest",
      ],
      { loadOperationalHandler: async () => handler }
    );
    const withoutWorkspace = await runCassCompat(
      ["search", "--robot", "--", "vitest"],
      { loadOperationalHandler: async () => handler }
    );

    expect(JSON.parse(withWorkspace.stdout).hits[0]).toHaveProperty(
      "workspace",
      "/data/projects/agent-session-search"
    );
    expect(JSON.parse(withoutWorkspace.stdout).hits[0]).not.toHaveProperty(
      "workspace"
    );
  });

  it("maps full cass fields with monotonic ordinal scores", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const output = candidateOutput("codex", "/sessions/template.jsonl");
    const template = output.results[0] as CandidateGroup;
    const first = candidateLead(
      template,
      "codex",
      "/sessions/one.jsonl",
      "first snippet"
    );
    first.sessionId = "grounded-session-id";
    output.results = [
      candidateGroup(template, 0, [
        first,
        candidateLead(
          template,
          "codex",
          "/sessions/two.jsonl",
          "second snippet"
        ),
        candidateLead(
          template,
          "codex",
          "/sessions/three.jsonl",
          "third snippet"
        ),
      ]),
    ];

    const completion = await runCassCompat(
      ["search", "--limit", "3", "--robot", "--", "vitest"],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({
            createSessionSearch: () => ({
              searchSessions: vi.fn(async () => output),
            }),
          }),
      }
    );
    const hits = JSON.parse(completion.stdout).hits;

    expect(hits.map((hit: { score: number }) => hit.score)).toEqual([
      1, 0.95, 0.9,
    ]);
    expect(hits[0]).toMatchObject({
      title: "grounded-session-id",
      snippet: "first snippet",
      content: "first snippet",
      match_type: "local",
      source_id: "local",
      origin_kind: "local",
    });
    expect(hits[1].title).toBe("two");
  });

  it("returns a successful empty envelope for legitimate no matches", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const output = candidateOutput("codex", "/sessions/template.jsonl");
    output.results = [];

    const completion = await runCassCompat(
      ["search", "--limit", "4", "--robot", "--", "absent"],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({
            createSessionSearch: () => ({
              searchSessions: vi.fn(async () => output),
            }),
          }),
      }
    );

    expect(completion).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(completion.stdout)).toEqual({
      query: "absent",
      limit: 4,
      offset: 0,
      count: 0,
      total_matches: 0,
      hits: [],
      max_tokens: null,
      request_id: null,
      cursor: null,
      hits_clamped: false,
    });
  });

  it("keeps partial source warnings on stderr with parseable success stdout", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const output = candidateOutput("codex", "/sessions/codex.jsonl");
    output.warnings = [
      {
        source: "pi",
        root: "/sessions/pi",
        code: "source_search_failed",
        message: "pi backend unavailable",
      },
    ];

    const completion = await runCassCompat(
      ["search", "--robot", "--", "vitest"],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({
            createSessionSearch: () => ({
              searchSessions: vi.fn(async () => output),
            }),
          }),
      }
    );

    expect(completion.exitCode).toBe(0);
    expect(JSON.parse(completion.stdout).hits).toHaveLength(1);
    expect(completion.stderr).toBe(
      "Search warning [source_search_failed] pi: pi backend unavailable\n"
    );
  });

  it("returns exit 9 instead of false-empty success when all sources fail", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const output = candidateOutput("codex", "/sessions/codex.jsonl");
    output.results = [];
    output.warnings = [
      {
        code: "all_sources_failed",
        message: "codex backend unavailable",
      },
    ];

    const completion = await runCassCompat(
      ["search", "--robot", "--", "vitest"],
      {
        loadOperationalHandler: async () =>
          searchModule.createCassCompatSearchHandler({
            createSessionSearch: () => ({
              searchSessions: vi.fn(async () => output),
            }),
          }),
      }
    );

    expect(completion).toMatchObject({ stdout: "", exitCode: 9 });
    expect(JSON.parse(completion.stderr)).toEqual({
      error: {
        code: 9,
        kind: "unknown",
        message: "All session sources failed: codex backend unavailable",
        hint: "Verify configured session roots and retry the search.",
        retryable: false,
      },
    });
    expect(completion.stderr.match(/"error"/g)).toHaveLength(1);
  });

  it("closes constructed search exactly once on nonempty zero and failure paths", async () => {
    const searchModule = await import("../src/cass-compat/search.js");
    const runCase = async (
      behavior: "nonempty" | "zero" | "total" | "throw"
    ) => {
      const close = vi.fn(async () => undefined);
      const searchSessions = vi.fn(async () => {
        if (behavior === "throw") throw new Error("backend exploded");
        const output = candidateOutput("codex", "/sessions/codex.jsonl");
        if (behavior === "zero") output.results = [];
        if (behavior === "total") {
          output.results = [];
          output.warnings = [
            { code: "all_sources_failed", message: "all failed" },
          ];
        }
        return output;
      });
      const completion = await runCassCompat(
        ["search", "--robot", "--", "vitest"],
        {
          loadOperationalHandler: async () =>
            searchModule.createCassCompatSearchHandler({
              createSessionSearch: () => ({ searchSessions, close }),
            }),
        }
      );
      return { close, completion };
    };

    const nonempty = await runCase("nonempty");
    const zero = await runCase("zero");
    const total = await runCase("total");
    const failure = await runCase("throw");

    expect(nonempty.completion.exitCode).toBe(0);
    expect(zero.completion.exitCode).toBe(0);
    expect(total.completion).toMatchObject({ stdout: "", exitCode: 9 });
    expect(failure.completion).toMatchObject({ stdout: "", exitCode: 9 });
    expect(nonempty.close).toHaveBeenCalledTimes(1);
    expect(zero.close).toHaveBeenCalledTimes(1);
    expect(total.close).toHaveBeenCalledTimes(1);
    expect(failure.close).toHaveBeenCalledTimes(1);
  });
});

function candidateGroup(
  template: CandidateGroup,
  priority: number,
  leads: SearchCandidate[]
): CandidateGroup {
  return {
    ...template,
    priority,
    shownLeadCount: leads.length,
    leads,
  };
}

function candidateLead(
  template: CandidateGroup,
  source: "claude" | "pi" | "codex",
  path: string,
  preview: string
): SearchCandidate {
  return {
    ...template.leads[0]!,
    source,
    path,
    preview,
    more: {
      evidence: {
        query: "vitest",
        sources: [source],
        resultsDisplayMode: "evidence",
        paths: [path],
      },
    },
  };
}

function candidateOutput(
  source: "claude" | "pi" | "codex",
  path: string,
  line?: number
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
            ...(line === undefined ? {} : { line }),
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
