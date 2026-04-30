import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionSearch } from "../src/search.js";

describe("createSessionSearch", () => {
  it("returns compact session candidates by default", async () => {
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

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search() {
            const sessionPath = join(
              source.root,
              "rollout-2026-04-29T10-15-17-019dd9cf-08bd-7580-827e-870084b36b6a.jsonl"
            );
            const otherSessionPath = join(source.root, "other.jsonl");
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: sessionPath,
                  line: 12,
                  content: "Done on paper-cuts / PR #227",
                  pattern: "PR #227",
                },
                {
                  source: source.name,
                  root: source.root,
                  path: sessionPath,
                  line: 40,
                  content:
                    "Pushed https://github.com/poolsideai/poolside-studio/pull/227",
                  pattern: "pull/227",
                },
                {
                  source: source.name,
                  root: source.root,
                  path: otherSessionPath,
                  line: 3,
                  content: "Unrelated bare timestamp 227",
                  pattern: "227",
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "find PR 227 papercuts branch",
      queries: ["PR #227", "paper-cuts"],
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalSessionPath = join(
      canonicalCodexRoot,
      "rollout-2026-04-29T10-15-17-019dd9cf-08bd-7580-827e-870084b36b6a.jsonl"
    );
    const canonicalOtherPath = join(canonicalCodexRoot, "other.jsonl");

    expect(result.resultsDisplayMode).toBe("candidates");
    expect(result.results).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: canonicalSessionPath,
        sessionId: "019dd9cf-08bd-7580-827e-870084b36b6a",
        line: 12,
        preview: "Done on paper-cuts / PR #227",
        hitCount: 2,
        matchedQueries: ["PR #227"],
        matchedPatterns: ["PR #227", "pull/227"],
        more: {
          evidence: {
            query: "find PR 227 papercuts branch",
            queries: ["PR #227", "paper-cuts"],
            sources: ["codex"],
            resultsDisplayMode: "evidence",
            paths: [canonicalSessionPath],
          },
        },
      },
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: canonicalOtherPath,
        line: 3,
        preview: "Unrelated bare timestamp 227",
        hitCount: 1,
        matchedQueries: ["PR #227"],
        matchedPatterns: ["227"],
        more: {
          evidence: {
            query: "find PR 227 papercuts branch",
            queries: ["PR #227", "paper-cuts"],
            sources: ["codex"],
            resultsDisplayMode: "evidence",
            paths: [canonicalOtherPath],
          },
        },
      },
    ]);
  });

  it("fans out one query across multiple selected roots and returns raw hits", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot, include: ["*.jsonl"] },
          { name: "claude", path: claudeRoot, include: ["*.jsonl"] },
        ],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push({ source, input });
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, `${source.name}.jsonl`),
                  line: 7,
                  content: `${source.name} saw ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["codex", "claude"],
      resultsDisplayMode: "evidence",
    });

    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalClaudeRoot = await realpath(claudeRoot);
    expect(result).toEqual({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      expandedPatterns: ["auth token timeout"],
      searchedSources: [
        {
          name: "codex",
          root: canonicalCodexRoot,
          include: ["*.jsonl"],
          status: "ok",
        },
        {
          name: "claude",
          root: canonicalClaudeRoot,
          include: ["*.jsonl"],
          status: "ok",
        },
      ],
      warnings: [],
      results: [
        {
          source: "codex",
          root: canonicalCodexRoot,
          path: join(canonicalCodexRoot, "codex.jsonl"),
          line: 7,
          content: "codex saw auth token timeout",
          pattern: "auth token timeout",
          query: "auth token timeout",
        },
        {
          source: "claude",
          root: canonicalClaudeRoot,
          path: join(canonicalClaudeRoot, "claude.jsonl"),
          line: 7,
          content: "claude saw auth token timeout",
          pattern: "auth token timeout",
          query: "auth token timeout",
        },
      ],
    });
    expect(calls).toEqual([
      {
        source: {
          name: "codex",
          root: canonicalCodexRoot,
          include: ["*.jsonl"],
          status: "ok",
        },
        input: {
          patterns: ["auth token timeout"],
          maxResults: 20,
          context: undefined,
          include: ["*.jsonl"],
        },
      },
      {
        source: {
          name: "claude",
          root: canonicalClaudeRoot,
          include: ["*.jsonl"],
          status: "ok",
        },
        input: {
          patterns: ["auth token timeout"],
          maxResults: 20,
          context: undefined,
          include: ["*.jsonl"],
        },
      },
    ]);
  });

  it("restricts evidence results to selected session paths", async () => {
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

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "selected.jsonl"),
                  line: 7,
                  content: `selected ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "other.jsonl"),
                  line: 9,
                  content: `other ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const selectedPath = join(canonicalCodexRoot, "selected.jsonl");

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      paths: [selectedPath],
    });

    expect(result.results).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: selectedPath,
        line: 7,
        content: "selected auth token timeout",
        pattern: "auth token timeout",
        query: "auth token timeout",
      },
    ]);
  });

  it("does not lose path-restricted evidence behind the normal result cap", async () => {
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
            calls.push(input);
            const results = [
              {
                source: source.name,
                root: source.root,
                path: join(source.root, "other.jsonl"),
                line: 1,
                content: "other auth token timeout",
                pattern: input.patterns[0],
              },
              {
                source: source.name,
                root: source.root,
                path: join(source.root, "selected.jsonl"),
                line: 2,
                content: "selected auth token timeout",
                pattern: input.patterns[0],
              },
            ];
            return {
              warnings: [],
              results:
                input.maxResults === undefined
                  ? results
                  : results.slice(0, input.maxResults),
            };
          },
        };
      },
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const selectedPath = join(canonicalCodexRoot, "selected.jsonl");

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      maxResultsPerSource: 1,
      paths: [selectedPath],
    });

    expect(calls).toEqual([
      {
        patterns: ["auth token timeout"],
        maxResults: undefined,
        context: undefined,
        paths: [selectedPath],
        include: ["*.jsonl"],
      },
    ]);
    expect(result.results).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: selectedPath,
        line: 2,
        content: "selected auth token timeout",
        pattern: "auth token timeout",
        query: "auth token timeout",
      },
    ]);
  });

  it("filters results through configured include patterns", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const cursorRoot = join(tmp, "cursor");
    const configPath = join(tmp, "config.json");
    await mkdir(cursorRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          {
            name: "cursor",
            path: cursorRoot,
            include: ["*/agent-transcripts/*"],
          },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(
                    source.root,
                    "project/agent-transcripts/session.txt"
                  ),
                  line: 2,
                  content: `allowed ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "project/logs/session.txt"),
                  line: 3,
                  content: `noise ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });
    const canonicalCursorRoot = await realpath(cursorRoot);

    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["cursor"],
      resultsDisplayMode: "evidence",
    });

    expect(result.results).toEqual([
      {
        source: "cursor",
        root: canonicalCursorRoot,
        path: join(
          canonicalCursorRoot,
          "project/agent-transcripts/session.txt"
        ),
        line: 2,
        content: "allowed auth token timeout",
        pattern: "auth token timeout",
        query: "auth token timeout",
      },
    ]);
  });

  it("searches Pool history across its shared root", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const poolRoot = join(tmp, "poolside");
    const configPath = join(tmp, "config.json");
    await mkdir(poolRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          {
            name: "pool",
            path: poolRoot,
            include: [
              "trajectories/*.ndjson",
              "logs/*.log",
              "sessions/*.json",
              "acp/**/*.json",
            ],
          },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            const content = `pool hit ${input.patterns[0]}`;
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "trajectories/session.ndjson"),
                  line: 1,
                  content,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "logs/pool.log"),
                  line: 2,
                  content,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "sessions/session.json"),
                  line: 3,
                  content,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "acp/workspace/session.json"),
                  line: 4,
                  content,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "cache/session.json"),
                  line: 5,
                  content: `filtered ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });
    const canonicalPoolRoot = await realpath(poolRoot);

    const result = await search.searchSessions({
      query: "pool smoke",
      sources: ["pool"],
      resultsDisplayMode: "evidence",
    });

    expect(result.results.map((hit) => hit.path)).toEqual([
      join(canonicalPoolRoot, "trajectories/session.ndjson"),
      join(canonicalPoolRoot, "logs/pool.log"),
      join(canonicalPoolRoot, "sessions/session.json"),
      join(canonicalPoolRoot, "acp/workspace/session.json"),
    ]);
  });

  it("uses agent-planned queries as the search probes while preserving the original request", async () => {
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
            calls.push(input);
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "session.jsonl"),
                  line: 4,
                  content: "Done on paper-cuts / PR #227",
                  pattern: "PR #227",
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "use agent-session-search to find PR 227 and papercuts branch",
      queries: ["PR #227", "paper-cuts"],
      resultsDisplayMode: "evidence",
      debug: true,
    });

    expect(result.query).toBe(
      "use agent-session-search to find PR 227 and papercuts branch"
    );
    expect(result.resultsDisplayMode).toBe("evidence");
    expect(result.expandedPatterns).toEqual([
      "PR #227",
      "PR 227",
      "pull/227",
      "pull request 227",
      "#227",
      "227",
      "paper-cuts",
      "paper_cuts",
      "paperCuts",
    ]);
    expect(calls).toEqual([
      {
        patterns: result.expandedPatterns,
        maxResults: 20,
        context: undefined,
        include: ["*.jsonl"],
      },
    ]);
    expect(result.results[0]).toMatchObject({
      content: "Done on paper-cuts / PR #227",
      pattern: "PR #227",
      query: "PR #227",
    });
    expect(result.debug).toMatchObject({
      input: {
        query: "use agent-session-search to find PR 227 and papercuts branch",
        queries: ["PR #227", "paper-cuts"],
      },
    });
  });

  it("returns resolved source status and missing-root warnings", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const hermesRoot = join(tmp, "missing-hermes");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot, include: ["*.jsonl"] },
          { name: "hermes", path: hermesRoot, include: ["*"] },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search() {
            return { warnings: [], results: [] };
          },
        };
      },
    });
    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["codex", "hermes"],
    });

    expect(result).toMatchObject({
      query: "auth token timeout",
      expandedPatterns: ["auth token timeout"],
      searchedSources: [
        {
          name: "codex",
          root: await realpath(codexRoot),
          status: "ok",
        },
        {
          name: "hermes",
          root: hermesRoot,
          status: "missing",
          warning: `Configured root does not exist: ${hermesRoot}`,
        },
      ],
      warnings: [
        {
          source: "hermes",
          root: hermesRoot,
          code: "missing_root",
          message: `Configured root does not exist: ${hermesRoot}`,
        },
      ],
      results: [],
    });
  });

  it("warns when requested sources do not select any enabled configured root", async () => {
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

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        throw new Error("backend should not be created");
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["codx"],
    });

    expect(result.searchedSources).toEqual([]);
    expect(result.warnings).toEqual([
      {
        source: "codx",
        code: "unknown_source",
        message: "Requested source is not configured or is disabled: codx",
      },
      {
        code: "no_sources_selected",
        message:
          "No enabled configured sources matched the requested source filter.",
      },
    ]);
    expect(result.results).toEqual([]);
  });

  it("reports a backend failure for one source while keeping successful source hits", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot },
          { name: "claude", path: claudeRoot },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            if (source.name === "claude") {
              throw new Error("backend unavailable");
            }
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "session.jsonl"),
                  line: 3,
                  content: `matched ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["codex", "claude"],
      resultsDisplayMode: "evidence",
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalClaudeRoot = await realpath(claudeRoot);

    expect(result.searchedSources).toEqual([
      {
        name: "codex",
        root: canonicalCodexRoot,
        status: "ok",
      },
      {
        name: "claude",
        root: canonicalClaudeRoot,
        status: "failed",
        warning: "Search failed for source claude: backend unavailable",
      },
    ]);
    expect(result.warnings).toEqual([
      {
        source: "claude",
        root: canonicalClaudeRoot,
        code: "source_search_failed",
        message: "Search failed for source claude: backend unavailable",
      },
    ]);
    expect(result.results).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: join(canonicalCodexRoot, "session.jsonl"),
        line: 3,
        content: "matched auth token timeout",
        pattern: "auth token timeout",
        query: "auth token timeout",
      },
    ]);
  });

  it("adds an all-sources-failed warning when every searchable source fails", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot },
          { name: "claude", path: claudeRoot },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search() {
            throw new Error(`${source.name} backend unavailable`);
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["codex", "claude"],
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalClaudeRoot = await realpath(claudeRoot);

    expect(result.results).toEqual([]);
    expect(result.searchedSources).toEqual([
      {
        name: "codex",
        root: canonicalCodexRoot,
        status: "failed",
        warning: "Search failed for source codex: codex backend unavailable",
      },
      {
        name: "claude",
        root: canonicalClaudeRoot,
        status: "failed",
        warning: "Search failed for source claude: claude backend unavailable",
      },
    ]);
    expect(result.warnings).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        code: "source_search_failed",
        message: "Search failed for source codex: codex backend unavailable",
      },
      {
        source: "claude",
        root: canonicalClaudeRoot,
        code: "source_search_failed",
        message: "Search failed for source claude: claude backend unavailable",
      },
      {
        code: "all_sources_failed",
        message: `All searchable sources failed. Fallback command: rg --line-number --fixed-strings 'auth token timeout' '${canonicalCodexRoot}' '${canonicalClaudeRoot}'`,
      },
    ]);
  });

  it("passes search options to backends, caps per-source results, and includes debug details", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push(input);
            return {
              warnings: [],
              results: [1, 2, 3].map((line) => ({
                source: source.name,
                root: source.root,
                path: join(source.root, "session.jsonl"),
                line,
                content: `match ${line}`,
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      maxPatterns: 3,
      maxResultsPerSource: 2,
      context: 4,
      debug: true,
    });

    expect(calls).toEqual([
      {
        patterns: ["auth token timeout"],
        maxResults: 2,
        context: 4,
      },
    ]);
    expect(result.expandedPatterns).toEqual(["auth token timeout"]);
    expect(result.resultsDisplayMode).toBe("debug");
    expect(result.results.map((hit) => hit.line)).toEqual([1, 2]);
    expect(result.debug).toEqual({
      input: {
        query: "auth token timeout",
        maxPatterns: 3,
        maxResultsPerSource: 2,
        context: 4,
        debug: true,
      },
      expandedPatterns: ["auth token timeout"],
    });
  });

  it("caps pathless evidence searches by default", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push(input);
            return {
              warnings: [],
              results: Array.from({ length: 25 }, (_, index) => ({
                source: source.name,
                root: source.root,
                path: join(source.root, "session.jsonl"),
                line: index + 1,
                content: `match ${index + 1}`,
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
    });

    expect(calls).toEqual([
      {
        patterns: ["auth token timeout"],
        maxResults: 20,
        context: undefined,
      },
    ]);
    expect(result.resultsDisplayMode).toBe("evidence");
    expect(result.results).toHaveLength(20);
    expect(result.warnings).toEqual([
      {
        code: "broad_evidence_capped",
        message:
          "Pathless evidence searches are capped at 20 results per source. Use candidates first, then pass a candidate more.evidence payload or --path for focused evidence.",
      },
    ]);
  });

  it("uses validated config defaults when request options are omitted", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
        defaults: {
          maxPatterns: 2,
          maxResultsPerSource: 1,
          context: 3,
        },
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push(input);
            return {
              warnings: [],
              results: [1, 2].map((line) => ({
                source: source.name,
                root: source.root,
                path: join(source.root, `${line}.jsonl`),
                line,
                content: `match ${line}`,
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: 'Find "auth token timeout" near parseSearchSessionsInput',
      resultsDisplayMode: "evidence",
    });

    expect(calls).toEqual([
      {
        patterns: ["auth token timeout", "parseSearchSessionsInput"],
        maxResults: 1,
        context: 3,
      },
    ]);
    expect(result.expandedPatterns).toEqual([
      "auth token timeout",
      "parseSearchSessionsInput",
    ]);
    expect(result.results).toHaveLength(1);
  });

  it("caps evidence content and candidate previews", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );
    const longContent = "x".repeat(9_000);

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "session.jsonl"),
                  line: 1,
                  content: longContent,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const evidence = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
    });
    const candidates = await search.searchSessions({
      query: "auth token timeout",
    });

    expect(evidence.results[0]).toMatchObject({
      content: `${"x".repeat(8_189)}...`,
    });
    expect(candidates.results[0]).toMatchObject({
      preview: `${"x".repeat(497)}...`,
    });
  });

  it("includes debug details when requested through resultsDisplayMode", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search() {
            return { warnings: [], results: [] };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "debug",
    });

    expect(result.resultsDisplayMode).toBe("debug");
    expect(result.debug).toEqual({
      input: {
        query: "auth token timeout",
        resultsDisplayMode: "debug",
      },
      expandedPatterns: ["auth token timeout"],
    });
  });

  it("rewrites natural-language queries into capped literal backend patterns", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search(input) {
            calls.push(input);
            return { warnings: [], results: [] };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query:
        'Find the bug in "auth token timeout" around src/search.ts for bd-iwz code thing',
      maxPatterns: 3,
    });

    expect(result.expandedPatterns).toEqual([
      "auth token timeout",
      "src/search.ts",
      "bd-iwz",
    ]);
    expect(calls).toEqual([
      {
        patterns: ["auth token timeout", "src/search.ts", "bd-iwz"],
        maxResults: undefined,
        context: undefined,
      },
    ]);
  });

  it("applies configured synonyms when rewriting search patterns", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
        synonyms: {
          auth: ["auth", "authentication", "login"],
          timeout: ["timeout", "deadline"],
        },
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search(input) {
            calls.push(input);
            return { warnings: [], results: [] };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "Find the auth timeout problem",
      maxPatterns: 4,
    });

    expect(result.expandedPatterns).toEqual([
      "auth",
      "authentication",
      "login",
      "timeout",
    ]);
    expect(calls).toEqual([
      {
        patterns: ["auth", "authentication", "login", "timeout"],
        maxResults: undefined,
        context: undefined,
      },
    ]);
  });

  it("preserves commands and emits obvious symbol naming variants", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search(input) {
            calls.push(input);
            return { warnings: [], results: [] };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query:
        "Run `npm test -- test/search.test.ts` near parseSearchSessionsInput",
      maxPatterns: 5,
    });

    expect(result.expandedPatterns).toEqual([
      "npm test -- test/search.test.ts",
      "test/search.test.ts",
      "parseSearchSessionsInput",
      "parse_search_sessions_input",
      "parse-search-sessions-input",
    ]);
    expect(calls).toEqual([
      {
        patterns: [
          "npm test -- test/search.test.ts",
          "test/search.test.ts",
          "parseSearchSessionsInput",
          "parse_search_sessions_input",
          "parse-search-sessions-input",
        ],
        maxResults: undefined,
        context: undefined,
      },
    ]);
  });

  it("treats backend error warnings without hits as source failures", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search() {
            return {
              warnings: [
                {
                  source: source.name,
                  root: source.root,
                  code: "fff_backend_error",
                  message: "grep failed: index unavailable",
                },
              ],
              results: [],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({ query: "auth token timeout" });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(result.searchedSources).toEqual([
      {
        name: "codex",
        root: canonicalCodexRoot,
        status: "failed",
        warning: "grep failed: index unavailable",
      },
    ]);
    expect(result.warnings).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        code: "fff_backend_error",
        message: "grep failed: index unavailable",
      },
      {
        code: "all_sources_failed",
        message: `All searchable sources failed. Fallback command: rg --line-number --fixed-strings 'auth token timeout' '${canonicalCodexRoot}'`,
      },
    ]);
  });
});
