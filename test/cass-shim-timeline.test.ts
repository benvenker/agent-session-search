import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolveSessionRootsOutput } from "../src/roots.js";
import { runCassCompat } from "../src/cass-compat/run.js";

type TimelineDependencies = {
  resolveRoots: () => Promise<ResolveSessionRootsOutput>;
  now: () => number;
};

type StatsDependencies = Pick<TimelineDependencies, "resolveRoots">;

async function runTimeline(
  argv: readonly string[],
  dependencies: TimelineDependencies
) {
  return runCassCompat(argv, {
    loadOperationalHandler: async () => {
      const { createTimelineHandler } =
        await import("../src/cass-compat/timeline.js");
      return createTimelineHandler(dependencies);
    },
  });
}

async function runStats(dependencies: StatsDependencies) {
  return runCassCompat(["stats", "--json"], {
    loadOperationalHandler: async () => {
      const { createStatsHandler } =
        await import("../src/cass-compat/stats.js");
      return createStatsHandler(dependencies);
    },
  });
}

describe("cass compatibility timeline and stats", () => {
  it("enumerates canonical included sessions without following directory symlinks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cass-shim-timeline-"));
    const firstRoot = join(directory, "first-root");
    const secondRoot = join(directory, "second-root");
    const outsideRoot = join(directory, "outside");
    const firstSession = join(firstRoot, "sessions", "nested", "alpha.jsonl");
    const excluded = join(firstRoot, "sessions", "nested", "ignored.txt");
    const secondSession = join(secondRoot, "project", "beta.json");
    const outsideSession = join(outsideRoot, "outside.jsonl");
    try {
      await Promise.all([
        mkdir(join(firstRoot, "sessions", "nested"), { recursive: true }),
        mkdir(join(secondRoot, "project"), { recursive: true }),
        mkdir(outsideRoot, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(firstSession, "not parsed"),
        writeFile(excluded, "excluded"),
        writeFile(secondSession, "also not parsed"),
        writeFile(outsideSession, "outside"),
      ]);
      await symlink(outsideRoot, join(firstRoot, "sessions", "linked"), "dir");
      await utimes(
        firstSession,
        new Date("2026-07-20T10:15:00.000Z"),
        new Date("2026-07-20T10:15:00.000Z")
      );
      await utimes(
        secondSession,
        new Date("2026-07-20T11:15:00.000Z"),
        new Date("2026-07-20T11:15:00.000Z")
      );
      const canonicalFirstRoot = await realpath(firstRoot);
      const canonicalSecondRoot = await realpath(secondRoot);
      const canonicalFirstSession = await realpath(firstSession);
      const canonicalSecondSession = await realpath(secondSession);

      const completion = await runTimeline(
        ["timeline", "--since", "7d", "--json"],
        {
          now: () => Date.parse("2026-07-20T12:00:00.000Z"),
          resolveRoots: async () => ({
            sources: [
              {
                name: "alpha",
                root: canonicalFirstRoot,
                include: ["sessions/**/*.jsonl"],
                status: "ok",
              },
              {
                name: "beta",
                root: canonicalSecondRoot,
                include: ["*.json"],
                status: "ok",
              },
            ],
            warnings: [],
          }),
        }
      );

      expect(completion.exitCode).toBe(0);
      expect(completion.stderr).toBe("");
      const payload = JSON.parse(completion.stdout);
      const entries = Object.values(payload.groups).flat() as Array<{
        source_path: string;
        agent: string;
      }>;
      expect(payload.total_sessions).toBe(2);
      expect(
        entries.map(({ source_path, agent }) => ({ source_path, agent }))
      ).toEqual([
        { source_path: canonicalSecondSession, agent: "beta" },
        { source_path: canonicalFirstSession, agent: "alpha" },
      ]);
      expect(completion.stdout).not.toContain("ignored.txt");
      expect(completion.stdout).not.toContain("outside.jsonl");
      expect(completion.stdout).not.toContain("linked");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("groups timeline records by UTC hour newest first and applies since before cap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cass-shim-cap-"));
    const root = join(directory, "root");
    const nowMs = Date.parse("2026-07-20T12:00:00.000Z");
    const cutoffMs = Date.parse("2026-07-13T12:00:00.000Z");
    try {
      await mkdir(root, { recursive: true });
      const beforeCutoff = await writeTimedFile(
        root,
        "before.jsonl",
        cutoffMs - 1
      );
      const exactCutoff = await writeTimedFile(root, "exact.jsonl", cutoffMs);
      const afterCutoff = await writeTimedFile(
        root,
        "after.jsonl",
        cutoffMs + 1
      );
      const canonicalRoot = await realpath(root);
      const dependencies: TimelineDependencies = {
        now: () => nowMs,
        resolveRoots: async () => ({
          sources: [
            {
              name: "claude",
              root: canonicalRoot,
              include: ["*.jsonl"],
              status: "ok",
            },
          ],
          warnings: [],
        }),
      };

      const boundaryCompletion = await runTimeline(
        ["timeline", "--since", "7d", "--json"],
        dependencies
      );
      const boundaryPayload = JSON.parse(boundaryCompletion.stdout);
      const boundaryEntries = Object.values(
        boundaryPayload.groups
      ).flat() as Array<{
        source_path: string;
      }>;
      expect(boundaryPayload.total_sessions).toBe(2);
      expect(boundaryEntries.map((entry) => entry.source_path)).toEqual([
        await realpath(afterCutoff),
        await realpath(exactCutoff),
      ]);
      expect(boundaryCompletion.stdout).not.toContain(beforeCutoff);

      const bulkStart = Date.parse("2026-07-19T00:00:00.000Z");
      for (let index = 0; index < 1_001; index += 1) {
        await writeTimedFile(
          root,
          `bulk-${String(index).padStart(4, "0")}.jsonl`,
          bulkStart + index * 1_000
        );
      }
      const hourBefore = await writeTimedFile(
        root,
        "hour-before.jsonl",
        Date.parse("2026-07-20T10:59:59.999Z")
      );
      const hourExact = await writeTimedFile(
        root,
        "hour-exact.jsonl",
        Date.parse("2026-07-20T11:00:00.000Z")
      );
      const hourAfter = await writeTimedFile(
        root,
        "hour-after.jsonl",
        Date.parse("2026-07-20T11:00:00.001Z")
      );

      const cappedCompletion = await runTimeline(
        ["timeline", "--since", "7d", "--json"],
        dependencies
      );
      const payload = JSON.parse(cappedCompletion.stdout);
      const groupKeys = Object.keys(payload.groups);
      const retainedEntries = Object.values(payload.groups).flat() as Array<{
        id: string;
        source_path: string;
        message_count: number;
        started_at: string;
      }>;

      expect(payload.range).toEqual({
        start: "2026-07-13T12:00:00.000Z",
        end: "2026-07-20T12:00:00.000Z",
      });
      expect(payload.total_sessions).toBe(1_006);
      expect(payload.truncated).toBe(true);
      expect(payload.limit).toBe(1_000);
      expect(retainedEntries).toHaveLength(1_000);
      expect(groupKeys.slice(0, 2)).toEqual([
        "2026-07-20 11:00",
        "2026-07-20 10:00",
      ]);
      expect(payload.groups["2026-07-20 11:00"]).toEqual([
        {
          id: `claude:${await realpath(hourAfter)}`,
          source_path: await realpath(hourAfter),
          agent: "claude_code",
          message_count: 0,
          started_at: "2026-07-20T11:00:00.001Z",
        },
        {
          id: `claude:${await realpath(hourExact)}`,
          source_path: await realpath(hourExact),
          agent: "claude_code",
          message_count: 0,
          started_at: "2026-07-20T11:00:00.000Z",
        },
      ]);
      expect(payload.groups["2026-07-20 10:00"]).toEqual([
        expect.objectContaining({
          id: `claude:${await realpath(hourBefore)}`,
          source_path: await realpath(hourBefore),
          message_count: 0,
        }),
      ]);
      expect(cappedCompletion.stdout).not.toContain(
        await realpath(exactCutoff)
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps partial timeline data but fails when all roots fail", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cass-shim-partial-"));
    const healthyRoot = join(directory, "healthy");
    const healthySession = join(healthyRoot, "session.jsonl");
    try {
      await mkdir(healthyRoot, { recursive: true });
      await writeFile(healthySession, "metadata only");
      await utimes(
        healthySession,
        new Date("2026-07-20T11:00:00.000Z"),
        new Date("2026-07-20T11:00:00.000Z")
      );
      const canonicalHealthyRoot = await realpath(healthyRoot);
      const canonicalHealthySession = await realpath(healthySession);

      const partial = await runTimeline(
        ["timeline", "--since", "7d", "--json"],
        {
          now: () => Date.parse("2026-07-20T12:00:00.000Z"),
          resolveRoots: async () => ({
            sources: [
              {
                name: "broken",
                root: join(directory, "broken"),
                status: "failed",
                warning: "Injected unreadable root",
              },
              {
                name: "healthy",
                root: canonicalHealthyRoot,
                include: ["*.jsonl"],
                status: "ok",
              },
            ],
            warnings: [],
          }),
        }
      );

      expect(partial.exitCode).toBe(0);
      expect(JSON.parse(partial.stdout).total_sessions).toBe(1);
      expect(partial.stdout).toContain(canonicalHealthySession);
      expect(JSON.parse(partial.stderr).warnings).toEqual([
        expect.objectContaining({
          source: "broken",
          code: "root_failed",
          message: "Injected unreadable root",
        }),
      ]);

      const failed = await runTimeline(
        ["timeline", "--since", "7d", "--json"],
        {
          now: () => Date.parse("2026-07-20T12:00:00.000Z"),
          resolveRoots: async () => ({
            sources: [
              {
                name: "broken",
                root: join(directory, "broken"),
                status: "failed",
                warning: "Injected unreadable root",
              },
            ],
            warnings: [],
          }),
        }
      );

      expect(failed.stdout).toBe("");
      expect(failed.exitCode).toBe(9);
      expect(failed.stderr.match(/"error"/g)).toHaveLength(1);
      expect(JSON.parse(failed.stderr).error).toMatchObject({
        code: 9,
        kind: "unknown",
        retryable: false,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports honest stats from metadata without reading transcripts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cass-shim-stats-"));
    const cappedRoot = join(directory, "capped");
    const claudeRoot = join(directory, "claude");
    try {
      await Promise.all([
        mkdir(cappedRoot, { recursive: true }),
        mkdir(claudeRoot, { recursive: true }),
      ]);
      await writeManyTimedFiles(
        cappedRoot,
        5_001,
        Date.parse("2026-07-18T00:00:00.000Z")
      );
      const olderClaude = await writeTimedFile(
        claudeRoot,
        "older.jsonl",
        Date.parse("2026-07-19T00:00:00.000Z")
      );
      await writeTimedFile(
        claudeRoot,
        "newer.jsonl",
        Date.parse("2026-07-20T00:00:00.000Z")
      );
      await chmod(olderClaude, 0o000);
      const canonicalCappedRoot = await realpath(cappedRoot);
      const canonicalClaudeRoot = await realpath(claudeRoot);

      const completion = await runStats({
        resolveRoots: async () => ({
          sources: [
            {
              name: "bulk",
              root: canonicalCappedRoot,
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
        }),
      });

      expect(completion.exitCode).toBe(0);
      expect(completion.stderr).toBe("");
      expect(JSON.parse(completion.stdout)).toEqual({
        conversations: 5_002,
        messages: null,
        messages_note: "not computed; session contents were not read",
        by_agent: {
          bulk: 5_000,
          claude_code: 2,
        },
        top_workspaces: [],
        date_range: {
          start: "2026-07-18T00:00:00.000Z",
          end: "2026-07-20T00:00:00.000Z",
        },
        raw_mirror: null,
        db_path: null,
        shim: {
          name: "agent-session-search-cass-shim",
          version: "0.7.1",
          engine: "fff-live",
        },
        enumeration: {
          per_root_limit: 5_000,
          truncated: true,
          truncated_roots: ["bulk"],
          exact: false,
        },
      });

      const failedStats = await runStats({
        resolveRoots: async () => ({
          sources: [
            {
              name: "broken",
              root: join(directory, "broken"),
              status: "failed",
              warning: "Injected unreadable root",
            },
          ],
          warnings: [],
        }),
      });
      expect(failedStats).toMatchObject({ stdout: "", exitCode: 9 });
      expect(failedStats.stderr.match(/"error"/g)).toHaveLength(1);
      expect(JSON.parse(failedStats.stderr).error.kind).toBe("unknown");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("feeds cm timeline groups canonical session paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cass-shim-cm-groups-"));
    const root = join(directory, "root");
    try {
      await mkdir(root, { recursive: true });
      const session = await writeTimedFile(
        root,
        "session.jsonl",
        Date.parse("2026-07-20T11:30:00.000Z")
      );
      const canonicalRoot = await realpath(root);
      const canonicalSession = await realpath(session);
      const completion = await runTimeline(
        ["timeline", "--since", "7d", "--json"],
        {
          now: () => Date.parse("2026-07-20T12:00:00.000Z"),
          resolveRoots: async () => ({
            sources: [
              {
                name: "pi",
                root: canonicalRoot,
                include: ["*.jsonl"],
                status: "ok",
              },
            ],
            warnings: [],
          }),
        }
      );

      const payload = JSON.parse(completion.stdout) as {
        groups: Record<
          string,
          Array<{
            path?: string;
            source_path?: string;
            agent?: string;
            messageCount?: number;
            message_count?: number;
          }>
        >;
      };
      const cmSessions = Object.values(payload.groups)
        .flat()
        .map((entry) => ({
          path: entry.path ?? entry.source_path ?? "",
          agent: entry.agent ?? "",
          messageCount: entry.messageCount ?? entry.message_count ?? 0,
        }))
        .filter((entry) => entry.path !== "");

      expect(cmSessions).toEqual([
        {
          path: canonicalSession,
          agent: "pi_agent",
          messageCount: 0,
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function writeTimedFile(root: string, name: string, mtimeMs: number) {
  const path = join(root, name);
  await writeFile(path, "metadata only");
  const timestamp = new Date(mtimeMs);
  await utimes(path, timestamp, timestamp);
  return path;
}

async function writeManyTimedFiles(
  root: string,
  count: number,
  mtimeMs: number
) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 32 }, async () => {
      while (cursor < count) {
        const index = cursor;
        cursor += 1;
        await writeTimedFile(
          root,
          `bulk-${String(index).padStart(4, "0")}.jsonl`,
          mtimeMs
        );
      }
    })
  );
}
