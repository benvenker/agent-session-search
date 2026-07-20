import type { CassCompatOperationalCommand } from "./run.js";
import {
  enumerateCassCompatSessions,
  formatCassCompatWarnings,
  type CassCompatSessionDependencies,
} from "./sessions.js";
import {
  completeError,
  completeJsonSuccess,
  type CassCompatCompletion,
} from "./output.js";

const TIMELINE_SESSION_LIMIT = 1_000;

export type CassCompatTimelineDependencies = CassCompatSessionDependencies & {
  now?: () => number;
};

export function createTimelineHandler(
  dependencies: CassCompatTimelineDependencies = {}
) {
  return async function handleTimeline(
    command: CassCompatOperationalCommand
  ): Promise<CassCompatCompletion> {
    if (command.verb !== "timeline") {
      throw new Error(`Timeline handler received ${command.verb}`);
    }

    const nowMs = (dependencies.now ?? Date.now)();
    const cutoffMs = nowMs - command.sinceDays * 86_400_000;
    const enumeration = await enumerateCassCompatSessions({}, dependencies);
    if (enumeration.successfulRoots === 0) {
      return completeError(
        9,
        "unknown",
        "Every configured session root failed during timeline enumeration",
        "Verify configured session roots and retry."
      );
    }

    const eligible = enumeration.records
      .filter((record) => record.mtimeMs >= cutoffMs)
      .sort(
        (left, right) =>
          right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path)
      );
    const retained = eligible.slice(0, TIMELINE_SESSION_LIMIT);
    const groups: Record<string, unknown[]> = {};
    for (const record of retained) {
      const startedAt = new Date(record.mtimeMs).toISOString();
      const groupKey = `${startedAt.slice(0, 13).replace("T", " ")}:00`;
      (groups[groupKey] ??= []).push({
        id: `${record.source}:${record.path}`,
        source_path: record.path,
        agent: record.agent,
        message_count: 0,
        started_at: startedAt,
      });
    }

    return completeJsonSuccess(
      {
        range: {
          start: new Date(cutoffMs).toISOString(),
          end: new Date(nowMs).toISOString(),
        },
        total_sessions: eligible.length,
        groups,
        truncated: eligible.length > TIMELINE_SESSION_LIMIT,
        limit: TIMELINE_SESSION_LIMIT,
      },
      formatCassCompatWarnings(enumeration.warnings)
    );
  };
}

export const handleCassCompatCommand = createTimelineHandler();
