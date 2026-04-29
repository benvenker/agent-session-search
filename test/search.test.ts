import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionSearch } from "../src/search.js";

describe("createSessionSearch", () => {
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

    const search = createSessionSearch({ configPath, defaultRoots: [] });
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
        {
          code: "not_implemented",
          message: "Search backend is not implemented yet.",
        },
      ],
      results: [],
    });
  });
});
