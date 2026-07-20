import { createSessionSearch } from "../search.js";
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
import { completeJsonSuccess } from "./output.js";

const CASS_COMPAT_DEFAULT_LIMIT = 10;
const MAX_OVERFETCH_DELTA = 40;

export type CreateCassCompatSessionSearch = () => SessionSearch;

export type CassCompatSearchHandlerOptions = {
  createSessionSearch?: CreateCassCompatSessionSearch;
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
    return completeJsonSuccess(minimalSearchEnvelope(command, output, limit));
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

function minimalSearchEnvelope(
  command: CassCompatSearchCommand,
  output: SearchSessionsOutput,
  limit: number
) {
  const hits = output.results
    .filter(isCandidateGroup)
    .flatMap((group) => group.leads)
    .slice(0, limit)
    .map((lead) => ({
      agent: cassCompatAgentForSource(lead.source) ?? lead.source,
    }));
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
