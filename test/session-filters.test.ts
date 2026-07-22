import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applySessionFileFilters,
  canonicalWorkspacePath,
  encodeWorkspaceDirName,
  prepareSessionFileFilters,
  resultPassesSessionFileFilters,
  stripDashes,
  workspaceEncodedSegmentMatch,
} from "../src/session-filters.js";

const DAY_MS = 86_400_000;

describe("session file filters", () => {
  it("uses one fixed inclusive days cutoff", async () => {
    const currentTime = 10 * DAY_MS;
    const now = vi.fn(() => currentTime);
    const mtimes = new Map([
      ["before", currentTime - DAY_MS - 1],
      ["boundary", currentTime - DAY_MS],
      ["after", currentTime - DAY_MS + 1],
      ["future", currentTime + 1],
    ]);
    const filters = await prepareSessionFileFilters(
      { days: 1 },
      {
        now,
        getMtimeMs: async ({ path }) => mtimes.get(path),
      }
    );

    await expect(
      resultPassesSessionFileFilters(
        { source: "codex", path: "before" },
        filters
      )
    ).resolves.toEqual({ passes: false, reason: "days" });
    for (const path of ["boundary", "after", "future"]) {
      await expect(
        resultPassesSessionFileFilters({ source: "codex", path }, filters)
      ).resolves.toEqual({ passes: true });
    }
    expect(now).toHaveBeenCalledTimes(1);
  });

  it("drops unstatable files only when days is active", async () => {
    const getMtimeMs = vi.fn(async () => undefined);
    const withDays = await prepareSessionFileFilters(
      { days: 1 },
      { now: () => DAY_MS, getMtimeMs }
    );

    await expect(
      resultPassesSessionFileFilters(
        { source: "claude", path: "/missing/session.jsonl" },
        withDays
      )
    ).resolves.toEqual({ passes: false, reason: "stat_failed" });

    const withoutDays = await prepareSessionFileFilters({}, { getMtimeMs });
    await expect(
      resultPassesSessionFileFilters(
        { source: "claude", path: "/missing/session.jsonl" },
        withoutDays
      )
    ).resolves.toEqual({ passes: true });
    expect(getMtimeMs).toHaveBeenCalledTimes(1);
  });

  it("matches exact Claude and OMP encoded workspace segments", () => {
    const encoded = encodeWorkspaceDirName(
      "/data/projects/agent-session-search"
    );

    expect(encoded).toBe("-data-projects-agent-session-search");
    expect(stripDashes("--data-projects-agent-session-search--")).toBe(
      "data-projects-agent-session-search"
    );
    expect(
      workspaceEncodedSegmentMatch(
        "/sessions/-data-projects-agent-session-search/session.jsonl",
        encoded
      )
    ).toBe(true);
    expect(
      workspaceEncodedSegmentMatch(
        "/sessions/--data-projects-agent-session-search--/session.jsonl",
        encoded
      )
    ).toBe(true);
    expect(
      workspaceEncodedSegmentMatch(
        "-data-projects-agent-session-search",
        encoded
      )
    ).toBe(true);
  });

  it("rejects encoded prefix, sibling, and missing-leading-dash collisions", () => {
    const encoded = encodeWorkspaceDirName(
      "/data/projects/themodernsocial-agent-platform"
    );
    for (const path of [
      "/sessions/-data-projects-themodernsocial/a.jsonl",
      "/sessions/-data-projects-themodernsocial-agent-platform-extra/a.jsonl",
      "/sessions/-data-projects/themodernsocial-agent-platform/a.jsonl",
      "/sessions/data-projects-themodernsocial-agent-platform/a.jsonl",
    ]) {
      expect(workspaceEncodedSegmentMatch(path, encoded)).toBe(false);
    }
  });

  it("matches direct containment against resolved and realpath workspace forms", async () => {
    const temp = await mkdtemp(join(tmpdir(), "session-filters-"));
    const realWorkspace = join(temp, "real-workspace");
    const aliasWorkspace = join(temp, "workspace-alias");
    try {
      await mkdir(realWorkspace);
      await symlink(realWorkspace, aliasWorkspace, "dir");

      await expect(canonicalWorkspacePath(aliasWorkspace)).resolves.toEqual({
        resolvedPath: aliasWorkspace,
        realPath: realWorkspace,
        canonicalPath: realWorkspace,
        forms: [aliasWorkspace, realWorkspace],
      });

      const missingWorkspace = join(temp, "missing-workspace");
      await expect(canonicalWorkspacePath(missingWorkspace)).resolves.toEqual({
        resolvedPath: missingWorkspace,
        canonicalPath: missingWorkspace,
        forms: [missingWorkspace],
      });
      const missingFilters = await prepareSessionFileFilters({
        workspace: missingWorkspace,
      });
      await expect(
        resultPassesSessionFileFilters(
          {
            source: "claude",
            path: `/sessions/${encodeWorkspaceDirName(missingWorkspace)}/a.jsonl`,
          },
          missingFilters
        )
      ).resolves.toEqual({ passes: false, reason: "workspace" });

      const filters = await prepareSessionFileFilters({
        workspace: aliasWorkspace,
      });
      for (const path of [
        join(aliasWorkspace, "session.jsonl"),
        join(realWorkspace, "nested", "session.jsonl"),
      ]) {
        await expect(
          resultPassesSessionFileFilters({ source: "codex", path }, filters)
        ).resolves.toEqual({ passes: true });
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("uses directional metadata project-path containment as a fallback", async () => {
    const temp = await mkdtemp(join(tmpdir(), "workspace-fallback-"));
    try {
      const workspace = temp;
      const parentDir = dirname(temp);
      const metadataByPath: Record<string, string[]> = {
        "/sessions/equal.jsonl": [workspace],
        "/sessions/descendant.jsonl": [`${workspace}/packages/cli`],
        "/sessions/dot-descendant.jsonl": [`${workspace}/..cache`],
        "/sessions/parent.jsonl": [parentDir],
        "/sessions/sibling.jsonl": [`${parentDir}/other`],
        "/sessions/token-only.jsonl": [
          "/archive/data-projects-agent-session-search-not-the-workspace",
        ],
        "/sessions/empty.jsonl": [],
      };
      const filters = await prepareSessionFileFilters(
        { workspace },
        {
          getMetadataProjectPaths: async ({ path }) =>
            metadataByPath[path] ?? [],
        }
      );

      for (const path of [
        "/sessions/equal.jsonl",
        "/sessions/descendant.jsonl",
        "/sessions/dot-descendant.jsonl",
      ]) {
        await expect(
          resultPassesSessionFileFilters({ source: "codex", path }, filters)
        ).resolves.toEqual({ passes: true });
      }
      for (const path of [
        "/sessions/parent.jsonl",
        "/sessions/sibling.jsonl",
        "/sessions/token-only.jsonl",
        "/sessions/empty.jsonl",
      ]) {
        await expect(
          resultPassesSessionFileFilters({ source: "codex", path }, filters)
        ).resolves.toEqual({ passes: false, reason: "workspace" });
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("ANDs days and workspace while preserving each drop reason", async () => {
    const temp = await mkdtemp(join(tmpdir(), "workspace-days-"));
    try {
      const workspace = temp;
      const now = 10 * DAY_MS;
      const mtimes = new Map([
        [`${workspace}/fresh.jsonl`, now],
        [`${workspace}/stale.jsonl`, now - 2 * DAY_MS],
        ["/sessions/other.jsonl", now],
      ]);
      const filters = await prepareSessionFileFilters(
        { days: 1, workspace },
        {
          now: () => now,
          getMtimeMs: async ({ path }) => mtimes.get(path),
          getMetadataProjectPaths: async () => [],
        }
      );
      const input = [
        { source: "codex", path: `${workspace}/fresh.jsonl`, id: "fresh" },
        { source: "codex", path: `${workspace}/stale.jsonl`, id: "stale" },
        { source: "codex", path: "/sessions/other.jsonl", id: "other" },
      ];

      const applied = await applySessionFileFilters(input, filters);

      expect(applied.results.map(({ id }) => id)).toEqual(["fresh"]);
      expect(
        applied.dropped.map(({ result, reason }) => [result.id, reason])
      ).toEqual([
        ["stale", "days"],
        ["other", "workspace"],
      ]);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("memoizes per source and path while skipping unnecessary metadata I/O", async () => {
    const temp = await mkdtemp(join(tmpdir(), "workspace-memoize-"));
    try {
      const workspace = temp;
      const now = 10 * DAY_MS;
      const getMtimeMs = vi.fn(async () => now);
      const getMetadataProjectPaths = vi.fn(async ({ source }) =>
        source === "codex" ? [workspace] : []
      );
      const filters = await prepareSessionFileFilters(
        { days: 1, workspace },
        { now: () => now, getMtimeMs, getMetadataProjectPaths }
      );
      const sharedPath = "/sessions/shared.jsonl";

      await expect(
        Promise.all([
          resultPassesSessionFileFilters(
            { source: "codex", path: sharedPath },
            filters
          ),
          resultPassesSessionFileFilters(
            { source: "codex", path: sharedPath },
            filters
          ),
          resultPassesSessionFileFilters(
            { source: "claude", path: sharedPath },
            filters
          ),
        ])
      ).resolves.toEqual([
        { passes: true },
        { passes: true },
        { passes: false, reason: "workspace" },
      ]);
      expect(getMtimeMs).toHaveBeenCalledTimes(2);
      expect(getMetadataProjectPaths).toHaveBeenCalledTimes(2);

      const skippedMetadata = vi.fn(async () => [workspace]);
      const directFilters = await prepareSessionFileFilters(
        { workspace },
        { getMetadataProjectPaths: skippedMetadata }
      );
      await resultPassesSessionFileFilters(
        { source: "codex", path: `${workspace}/session.jsonl` },
        directFilters
      );
      const daysOnlyFilters = await prepareSessionFileFilters(
        { days: 1 },
        {
          now: () => now,
          getMtimeMs: async () => now,
          getMetadataProjectPaths: skippedMetadata,
        }
      );
      await resultPassesSessionFileFilters(
        { source: "codex", path: "/sessions/other.jsonl" },
        daysOnlyFilters
      );
      expect(skippedMetadata).toHaveBeenCalledTimes(0);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
