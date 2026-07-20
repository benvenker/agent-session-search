import { cassCompatShimIdentity } from "./health.js";
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

const STATS_PER_ROOT_LIMIT = 5_000;

export function createStatsHandler(
  dependencies: CassCompatSessionDependencies = {}
) {
  return async function handleStats(
    command: CassCompatOperationalCommand
  ): Promise<CassCompatCompletion> {
    if (command.verb !== "stats") {
      throw new Error(`Stats handler received ${command.verb}`);
    }

    const enumeration = await enumerateCassCompatSessions(
      { maxFilesPerRoot: STATS_PER_ROOT_LIMIT },
      dependencies
    );
    if (enumeration.successfulRoots === 0) {
      return completeError(
        9,
        "unknown",
        "Every configured session root failed during stats enumeration",
        "Verify configured session roots and retry."
      );
    }

    const byAgent: Record<string, number> = {};
    for (const record of enumeration.records) {
      byAgent[record.agent] = (byAgent[record.agent] ?? 0) + 1;
    }
    let earliestMtime = Number.POSITIVE_INFINITY;
    let latestMtime = Number.NEGATIVE_INFINITY;
    for (const record of enumeration.records) {
      earliestMtime = Math.min(earliestMtime, record.mtimeMs);
      latestMtime = Math.max(latestMtime, record.mtimeMs);
    }
    const truncated = enumeration.truncatedRoots.length > 0;

    return completeJsonSuccess(
      {
        conversations: enumeration.records.length,
        messages: null,
        messages_note: "not computed; session contents were not read",
        by_agent: Object.fromEntries(
          Object.entries(byAgent).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        ),
        top_workspaces: [],
        date_range:
          enumeration.records.length === 0
            ? null
            : {
                start: new Date(earliestMtime).toISOString(),
                end: new Date(latestMtime).toISOString(),
              },
        raw_mirror: null,
        db_path: null,
        shim: cassCompatShimIdentity(),
        enumeration: {
          per_root_limit: STATS_PER_ROOT_LIMIT,
          truncated,
          truncated_roots: enumeration.truncatedRoots,
          exact: !truncated && enumeration.warnings.length === 0,
        },
      },
      formatCassCompatWarnings(enumeration.warnings)
    );
  };
}

export const handleCassCompatCommand = createStatsHandler();
