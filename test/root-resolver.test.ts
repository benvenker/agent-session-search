import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { defaultSessionRoots, resolveSessionRoots } from "../src/roots.js";

describe("resolveSessionRoots", () => {
  it("defines built-in defaults for supported session sources", () => {
    expect(defaultSessionRoots("/Users/ben")).toEqual([
      {
        name: "codex",
        path: "/Users/ben/.codex/sessions",
        include: ["*.jsonl"],
      },
      {
        name: "claude",
        path: "/Users/ben/.claude/projects",
        include: ["*.jsonl"],
      },
      { name: "pi", path: "/Users/ben/.pi/agent/sessions", include: ["*"] },
      {
        name: "cursor",
        path: "/Users/ben/.cursor/projects",
        include: ["*/agent-transcripts/*"],
      },
      { name: "hermes", path: "/Users/ben/.hermes/sessions", include: ["*"] },
      {
        name: "pool",
        path: "/Users/ben/Library/Application Support/poolside",
        include: ["trajectories/*.ndjson", "sessions/*.json", "acp/**/*.json"],
      },
    ]);
  });

  it("loads configured roots and reports missing roots as warnings", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const existingRoot = join(tmp, "codex");
    const missingRoot = join(tmp, "missing-claude");
    const configPath = join(tmp, "config.json");

    await mkdir(existingRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: existingRoot, include: ["*.jsonl"] },
          { name: "claude", path: missingRoot, include: ["*.jsonl"] },
        ],
      })
    );

    const resolved = await resolveSessionRoots({
      configPath,
      defaultRoots: [],
    });
    const canonicalExistingRoot = await realpath(existingRoot);

    expect(resolved.sources).toEqual([
      {
        name: "codex",
        root: canonicalExistingRoot,
        include: ["*.jsonl"],
        status: "ok",
      },
      {
        name: "claude",
        root: missingRoot,
        include: ["*.jsonl"],
        status: "missing",
        warning: `Configured root does not exist: ${missingRoot}`,
      },
    ]);
    expect(resolved.warnings).toEqual([
      {
        source: "claude",
        root: missingRoot,
        code: "missing_root",
        message: `Configured root does not exist: ${missingRoot}`,
      },
    ]);
  });

  it("uses default roots when config is absent and filters requested sources", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const customRoot = join(tmp, "custom");
    await mkdir(codexRoot);
    await mkdir(customRoot);

    const resolved = await resolveSessionRoots({
      configPath: join(tmp, "does-not-exist.json"),
      sources: ["custom-agent"],
      defaultRoots: [
        { name: "codex", path: codexRoot, include: ["*.jsonl"] },
        {
          name: "custom-agent",
          path: customRoot,
          include: ["*.log"],
          enabled: true,
        },
        { name: "disabled-agent", path: join(tmp, "disabled"), enabled: false },
      ],
    });

    expect(resolved).toEqual({
      sources: [
        {
          name: "custom-agent",
          root: await realpath(customRoot),
          include: ["*.log"],
          status: "ok",
        },
      ],
      warnings: [],
    });
  });

  it("merges configured roots with defaults by overriding matching names and adding custom names", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const defaultCodexRoot = join(tmp, "default-codex");
    const configuredCodexRoot = join(tmp, "configured-codex");
    const customRoot = join(tmp, "custom");
    const configPath = join(tmp, "config.json");
    await mkdir(defaultCodexRoot);
    await mkdir(configuredCodexRoot);
    await mkdir(customRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          {
            name: "codex",
            path: configuredCodexRoot,
            include: ["configured/*.jsonl"],
          },
          { name: "custom-agent", path: customRoot, include: ["*.txt"] },
        ],
      })
    );

    const resolved = await resolveSessionRoots({
      configPath,
      defaultRoots: [
        { name: "codex", path: defaultCodexRoot, include: ["default/*.jsonl"] },
        { name: "hermes", path: join(tmp, "missing-hermes"), include: ["*"] },
      ],
    });

    expect(resolved.sources).toEqual([
      {
        name: "codex",
        root: await realpath(configuredCodexRoot),
        include: ["configured/*.jsonl"],
        status: "ok",
      },
      {
        name: "hermes",
        root: join(tmp, "missing-hermes"),
        include: ["*"],
        status: "missing",
        warning: `Configured root does not exist: ${join(tmp, "missing-hermes")}`,
      },
      {
        name: "custom-agent",
        root: await realpath(customRoot),
        include: ["*.txt"],
        status: "ok",
      },
    ]);
  });
});
