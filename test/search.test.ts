import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionSearch } from "../src/search.js";

describe("createSessionSearch", () => {
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
      }),
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
    });

    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalClaudeRoot = await realpath(claudeRoot);
    expect(result).toEqual({
      query: "auth token timeout",
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
        },
        {
          source: "claude",
          root: canonicalClaudeRoot,
          path: join(canonicalClaudeRoot, "claude.jsonl"),
          line: 7,
          content: "claude saw auth token timeout",
          pattern: "auth token timeout",
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
          maxResults: undefined,
          context: undefined,
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
          maxResults: undefined,
          context: undefined,
        },
      },
    ]);
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
      }),
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
      }),
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
      }),
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
        message:
          "All searchable sources failed. Try rg directly against the configured source roots if FFF is unavailable.",
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
      }),
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

  it("treats backend error warnings without hits as source failures", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      }),
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
        message:
          "All searchable sources failed. Try rg directly against the configured source roots if FFF is unavailable.",
      },
    ]);
  });
});
