import { createSessionSearch } from "../search.js";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type {
  CandidateGroup,
  SearchSessionsInput,
  SearchSessionsOutput,
  SessionSearch,
  SourceName,
} from "../types.js";
import type { CassCompatOperationalHandler } from "./run.js";
import type { CassCompatSearchCommand } from "./argv.js";
import {
  CASS_COMPAT_AGENT_SLUGS,
  cassCompatAgentForSource,
  sourceForCassCompatAgent,
} from "./agents.js";
import { completeError, completeJsonSuccess } from "./output.js";

const CASS_COMPAT_DEFAULT_LIMIT = 10;
const MAX_OVERFETCH_DELTA = 40;
export const CASS_SHIM_DEFAULT_LINE_NUMBER = 1;

export type CreateCassCompatSessionSearch = () => SessionSearch;

export type CassCompatSearchHandlerOptions = {
  createSessionSearch?: CreateCassCompatSessionSearch;
  statPath?: (path: string) => Promise<{ mtimeMs: number }>;
};

export function createCassCompatSearchHandler(
  options: CassCompatSearchHandlerOptions = {}
): CassCompatOperationalHandler {
  return async (command) => {
    if (command.verb !== "search") {
      throw new Error(`Search handler cannot handle ${command.verb}`);
    }
    return runSearch(command, options);
  };
}

export const handleCassCompatCommand = createCassCompatSearchHandler();

async function runSearch(
  command: CassCompatSearchCommand,
  options: CassCompatSearchHandlerOptions
) {
  const limit = command.limit ?? CASS_COMPAT_DEFAULT_LIMIT;
  const mappedSources = mapRequestedSources(command.agents);
  if (!mappedSources.ok) {
    return completeJsonSuccess(
      emptySearchEnvelope(command.query, limit),
      `Unsupported agent slug ${mappedSources.slug}. Accepted agent slugs: ${CASS_COMPAT_AGENT_SLUGS.join(", ")}.\n`
    );
  }

  const input: SearchSessionsInput = {
    query: command.query,
    resultsDisplayMode: "candidates",
    maxResultsPerSource: boundedOverfetch(limit),
  };
  if (mappedSources.sources.length > 0) input.sources = mappedSources.sources;
  if (command.days !== undefined) input.days = command.days;
  if (command.workspace !== undefined) input.workspace = command.workspace;

  const factory = options.createSessionSearch ?? createSessionSearch;
  const search = factory();
  try {
    const output = await search.searchSessions(input);
    const totalFailure = output.warnings.find(
      (warning) => warning.code === "all_sources_failed"
    );
    if (totalFailure) {
      return completeError(
        9,
        "unknown",
        `All session sources failed: ${totalFailure.message}`,
        "Verify configured session roots and retry the search."
      );
    }
    return completeJsonSuccess(
      await searchEnvelope(command, output, limit, options.statPath),
      summarizeWarnings(output)
    );
  } finally {
    await search.close?.();
  }
}

function mapRequestedSources(
  agents: readonly string[]
): { ok: true; sources: SourceName[] } | { ok: false; slug: string } {
  const sources: SourceName[] = [];
  for (const agent of agents) {
    const source = sourceForCassCompatAgent(agent);
    if (source === undefined) return { ok: false, slug: agent };
    if (!sources.includes(source)) sources.push(source);
  }
  return { ok: true, sources };
}

function boundedOverfetch(limit: number): number {
  const delta = Math.min(
    limit * 2,
    MAX_OVERFETCH_DELTA,
    Number.MAX_SAFE_INTEGER - limit
  );
  return limit + delta;
}

async function searchEnvelope(
  command: CassCompatSearchCommand,
  output: SearchSessionsOutput,
  limit: number,
  statPath: (path: string) => Promise<{ mtimeMs: number }> = stat
) {
  const groups = output.results
    .filter(isCandidateGroup)
    .sort((left, right) => left.priority - right.priority);
  const seen = new Set<string>();
  const selected = [];
  for (const lead of groups.flatMap((group) => group.leads)) {
    const key = `${lead.source}\0${lead.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(lead);
    if (selected.length === limit) break;
  }
  const hits = await Promise.all(
    selected.map(async (lead, index) => {
      let createdAt: number | undefined;
      try {
        const metadata = await statPath(lead.path);
        if (Number.isFinite(metadata.mtimeMs)) createdAt = metadata.mtimeMs;
      } catch {
        // created_at is optional and must be omitted when filesystem metadata fails.
      }
      return {
        title: lead.sessionId ?? basename(lead.path, extname(lead.path)),
        source_path: lead.path,
        agent: cassCompatAgentForSource(lead.source) ?? lead.source,
        snippet: lead.preview,
        content: lead.preview,
        score: Math.max(0, Number((1 - index * 0.05).toFixed(2))),
        line_number: lead.line ?? CASS_SHIM_DEFAULT_LINE_NUMBER,
        match_type: "local",
        source_id: "local",
        origin_kind: "local",
        ...(command.workspace === undefined
          ? {}
          : { workspace: command.workspace }),
        ...(createdAt === undefined ? {} : { created_at: createdAt }),
      };
    })
  );
  return {
    ...emptySearchEnvelope(command.query, limit),
    count: hits.length,
    total_matches: hits.length,
    hits,
  };
}

function emptySearchEnvelope(query: string, limit: number) {
  return {
    query,
    limit,
    offset: 0,
    count: 0,
    total_matches: 0,
    hits: [],
    max_tokens: null,
    request_id: null,
    cursor: null,
    hits_clamped: false,
  };
}

function isCandidateGroup(
  result: SearchSessionsOutput["results"][number]
): result is CandidateGroup {
  return "leads" in result && Array.isArray(result.leads);
}

function summarizeWarnings(output: SearchSessionsOutput): string {
  return output.warnings
    .map(
      (warning) =>
        `Search warning [${warning.code}]${warning.source ? ` ${warning.source}:` : ":"} ${warning.message}\n`
    )
    .join("");
}
