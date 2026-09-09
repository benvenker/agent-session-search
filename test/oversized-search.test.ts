import {
  chmod,
  mkdtemp,
  realpath,
  writeFile,
  mkdir,
  symlink,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { searchOversizedFiles } from "../src/oversized-search.js";
import { createSessionSearch } from "../src/search.js";
import { OneRootFffBackend } from "../src/fff-backend.js";

const padding = "x".repeat(10 * 1024 * 1024);
async function fixture() {
  return realpath(await mkdtemp(join(tmpdir(), "agent-session-search-rg-")));
}

describe("oversized transcript fallback", () => {
  it("discovers included oversized files and preserves literal matches on long lines", async () => {
    const root = await fixture();
    await mkdir(join(root, "sessions"));
    const path = join(root, "sessions", "session.jsonl");
    await writeFile(
      path,
      padding +
        "\n" +
        JSON.stringify({
          text: "context ".repeat(5000) + "Search immediately closes",
        }) +
        "\n"
    );
    await writeFile(
      join(root, "excluded.jsonl"),
      padding + "\nSearch immediately closes\n"
    );
    const result = await searchOversizedFiles({
      source: "codex",
      root,
      patterns: ["Search immediately closes"],
      include: ["sessions/*.jsonl"],
    });
    expect(result.filesSearched).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      source: "codex",
      root,
      path,
      line: 2,
      pattern: "Search immediately closes",
    });
    expect(result.results[0].content).toContain("Search immediately closes");
    expect(Buffer.byteLength(result.results[0].content)).toBeLessThanOrEqual(
      2052
    );
  });

  it("treats regex syntax literally and rg exit 1 as a clean no-match", async () => {
    const root = await fixture();
    const path = join(root, "session.jsonl");
    await writeFile(path, padding + "\nauth.token\nauthXtoken\n");
    const result = await searchOversizedFiles({
      source: "codex",
      root,
      patterns: ["auth.token"],
    });
    expect(result.results.map((hit) => hit.content)).toEqual(["auth.token"]);
    const empty = await searchOversizedFiles({
      source: "codex",
      root,
      patterns: ["missing[.*]"],
    });
    expect(empty.results).toEqual([]);
    expect(empty.warnings).toEqual([]);
    expect(empty.filesSearched).toBe(1);
  });

  it("preserves smart-case matching and byte offsets after Unicode text", async () => {
    const root = await fixture();
    const path = join(root, "session.jsonl");
    await writeFile(
      path,
      padding +
        "\n" +
        "雪".repeat(1000) +
        "Search immediately closes\nsearch immediately closes\n"
    );
    const result = await searchOversizedFiles({
      source: "codex",
      root,
      patterns: ["search immediately closes"],
      include: [],
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].content).toContain("Search immediately closes");
    expect(result.results[0].line).toBe(2);
    const upper = await searchOversizedFiles({
      source: "codex",
      root,
      patterns: ["Search immediately closes"],
    });
    expect(upper.results).toHaveLength(1);
  });

  it("does not search the 10 MiB boundary, excluded paths, or symlinks outside the source", async () => {
    const root = await fixture();
    const outside = await fixture();
    await writeFile(join(root, "boundary.jsonl"), padding);
    await writeFile(join(outside, "session.jsonl"), padding + "needle");
    await symlink(join(outside, "session.jsonl"), join(root, "escape.jsonl"));
    const result = await searchOversizedFiles({
      source: "codex",
      root,
      patterns: ["needle"],
      paths: [
        join(root, "boundary.jsonl"),
        join(root, "escape.jsonl"),
        join(outside, "session.jsonl"),
      ],
    });
    expect(result).toEqual({ results: [], warnings: [], filesSearched: 0 });
  });

  it("reports missing rg instead of claiming no matches", async () => {
    const root = await fixture();
    await writeFile(join(root, "session.jsonl"), padding + "needle");
    vi.stubEnv("PATH", root);
    try {
      const result = await searchOversizedFiles({
        source: "codex",
        root,
        patterns: ["needle"],
      });
      expect(result.results).toEqual([]);
      expect(result.warnings).toMatchObject([
        {
          code: "ripgrep_fallback_error",
          recommendedAction: expect.stringContaining("installed on PATH"),
        },
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("bounds dense matches and reports incomplete fallback output", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "session.jsonl"),
      padding + "\n" + "needle\n".repeat(1100)
    );
    const result = await searchOversizedFiles({
      source: "codex",
      root,
      patterns: ["needle"],
    });
    expect(result.results).toHaveLength(1000);
    expect(
      result.warnings.some(
        (warning) => warning.code === "ripgrep_fallback_limit"
      )
    ).toBe(true);
  });

  it("prioritizes exact probes across files before common-word fallback probes", async () => {
    const root = await fixture();
    const noisy = join(root, "noisy.jsonl");
    const selected = join(root, "selected.jsonl");
    await writeFile(noisy, padding + "\n" + "Search\n".repeat(1100));
    await writeFile(selected, padding + "\nSearch immediately closes\n");
    const result = await searchOversizedFiles({
      source: "codex",
      root,
      patterns: ["Search immediately closes", "Search"],
      paths: [noisy, selected],
      maxResults: 1,
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      path: selected,
      content: "Search immediately closes",
      pattern: "Search immediately closes",
    });
  });

  it("continues after an unavailable selected file", async () => {
    const root = await fixture();
    const selected = join(root, "selected.jsonl");
    await writeFile(selected, padding + "\nneedle\n");
    const result = await searchOversizedFiles({
      source: "codex",
      root,
      patterns: ["needle"],
      paths: [join(root, "missing.jsonl"), selected],
    });
    expect(result.results).toHaveLength(1);
    expect(result.warnings).toMatchObject([{ code: "ripgrep_fallback_error" }]);
  });

  it("reports rg errors with bounded diagnostics", async () => {
    const root = await fixture();
    await writeFile(join(root, "session.jsonl"), padding + "\nneedle\n");
    await writeFile(
      join(root, "rg"),
      "#!/bin/sh\necho 'fixture failure' >&2\nexit 2\n"
    );
    await chmod(join(root, "rg"), 0o755);
    vi.stubEnv("PATH", root);
    try {
      const result = await searchOversizedFiles({
        source: "codex",
        root,
        patterns: ["needle"],
      });
      expect(result.results).toEqual([]);
      expect(result.warnings[0]?.message).toContain(
        "status 2: fixture failure"
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("applies workspace and days before fallback budgets and preserves managed metadata", async () => {
    const root = await fixture();
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const configPath = join(root, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: root, include: ["*.jsonl"] }],
      })
    );
    const rejected = join(root, "rejected.jsonl");
    const selected = join(workspace, "selected.jsonl");
    const stale = join(workspace, "stale.jsonl");
    await writeFile(rejected, padding + "\n" + "needle\n".repeat(1100));
    await writeFile(
      selected,
      padding +
        "\n" +
        JSON.stringify({ text: "context ".repeat(100) + "needle" }) +
        "\n"
    );
    await writeFile(stale, padding + "\nneedle\n");
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await utimes(stale, old, old);
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return new OneRootFffBackend({
          source: source.name,
          root: source.root,
          emptyResultRetryAttempts: 0,
          client: {
            async grep() {
              return { content: [] };
            },
          },
        });
      },
    });
    const result = await search.searchSessions({
      query: "needle",
      sources: ["codex"],
      days: 2,
      workspace,
      maxResultsPerSource: 1,
    });
    expect(result.metadata.backend.oversizedFallback).toEqual({
      engine: "ripgrep",
      filesSearched: 1,
    });
    expect(result.warnings).toEqual([]);
    const group = result.results[0] as {
      leads: { path: string; preview: string }[];
    };
    expect(group.leads).toHaveLength(1);
    expect(group.leads[0].path).toBe(selected);
    expect(group.leads[0].preview).toContain("needle");
    await search.close?.();
  });
});
