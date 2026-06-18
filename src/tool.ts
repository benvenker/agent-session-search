import { z } from "zod";
import {
  groupCandidatesFingerprint,
  groupCandidatesFingerprintIsValid,
  stringArraysEqual,
} from "./followup.js";
import type { SearchSessionsInput, SessionSearch } from "./types.js";

const matchGroupIdSchema = z.enum([
  "exact_or_structured",
  "phrase_or_adjacent_terms",
  "multi_term_coverage",
  "distinctive_term",
  "loose_fallback",
]);

const callerSessionSchema = z
  .object({
    source: z.string().min(1),
    sessionId: z.string().min(1),
  })
  .strict()
  .describe(
    "Reliable caller identity for current-session demotion. Use only when the calling agent knows its live session id; do not invent this value."
  );

const groupCandidatesFollowupSchema = z
  .object({
    query: z.string().min(1),
    queries: z.array(z.string().min(1)).optional(),
    operationalContext: z.unknown().optional(),
    callerSession: callerSessionSchema.optional(),
    sources: z.union([z.array(z.string()), z.literal("all")]).optional(),
    resultsDisplayMode: z.literal("candidates"),
    paths: z.array(z.string().min(1)).optional(),
    maxPatterns: z.number().int().positive().optional(),
    maxResultsPerSource: z.number().int().positive().optional(),
    context: z.number().int().min(0).optional(),
    planFingerprint: z.string().min(1),
    fingerprint: z.string().min(1),
    group: z
      .object({
        id: matchGroupIdSchema,
        priority: z.number().int().min(0),
        patternIds: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    offset: z.number().int().min(0),
    limit: z.number().int().positive().max(50),
  })
  .strict()
  .describe(
    "Server-prepared payload copied from a candidate group more.groupCandidates field. Do not invent this payload; echo it exactly to request more leads for one group."
  );

export const searchSessionsInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Concise human-readable recall task. Do not include output-format instructions, examples, or tool-use directions."
    ),
  queries: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Short literal search probes planned by the caller. Use several focused phrases for conversational or underspecified recall requests."
    ),
  operationalContext: z
    .unknown()
    .optional()
    .describe(
      "Helpful non-search context such as cwd, repo, branch, recent chat, and why the user is searching."
    ),
  callerSession: callerSessionSchema.optional(),
  sources: z
    .union([z.array(z.string()), z.literal("all")])
    .optional()
    .describe(
      'Source names to search, such as ["codex", "claude"], or "all" for every enabled source.'
    ),
  resultsDisplayMode: z
    .enum(["candidates", "evidence", "debug"])
    .optional()
    .describe(
      "Result detail level. Use candidates first, evidence with a candidate more.evidence follow-up, and debug only for diagnostics. Evidence without paths is grouped by path and capped by default."
    ),
  groupCandidates: groupCandidatesFollowupSchema.optional(),
  paths: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Restrict evidence results to canonical session paths, usually copied from a candidate more.evidence payload."
    ),
  maxPatterns: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum number of expanded literal patterns to search."),
  maxResultsPerSource: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Maximum number of backend hits to consider for each searched source. Useful for intentionally unscoped evidence searches and explicit caps on focused evidence."
    ),
  context: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Requested matching-line context. Reserved for backend support; current FFF results remain bounded snippets."
    ),
  debug: z
    .boolean()
    .optional()
    .describe(
      "Include query expansion and diagnostics. Candidate-mode debug responses also include ranking explanations."
    ),
  planFingerprint: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Continuation shorthand only: copied from more.groupCandidates.planFingerprint when echoing that payload at the top level."
    ),
  fingerprint: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Continuation shorthand only: copied from more.groupCandidates.fingerprint when echoing that payload at the top level."
    ),
  group: groupCandidatesFollowupSchema.shape.group
    .optional()
    .describe(
      "Continuation shorthand only: copied from more.groupCandidates.group when echoing that payload at the top level."
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Continuation shorthand only: copied from more.groupCandidates.offset when echoing that payload at the top level."
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe(
      "Continuation shorthand only: copied from more.groupCandidates.limit when echoing that payload at the top level."
    ),
});

export type SearchSessionsToolInput = z.infer<typeof searchSessionsInputSchema>;

export class SearchSessionsInputError extends Error {
  readonly code = "invalid_group_followup";
  readonly invalidField: string;
  readonly correctedShape: Record<string, unknown>;

  constructor(invalidField: string, message: string) {
    super(message);
    this.name = "SearchSessionsInputError";
    this.invalidField = invalidField;
    this.correctedShape = {
      query: "<same query as the top-level request>",
      groupCandidates: {
        query: "<same query as the top-level request>",
        operationalContext:
          "<same operationalContext value as the server-prepared payload, when present>",
        callerSession:
          "<same callerSession value as the server-prepared payload, when present>",
        sources: ["<same source names as the original response>"],
        resultsDisplayMode: "candidates",
        maxPatterns:
          "<same maxPatterns value as the server-prepared payload, when present>",
        maxResultsPerSource:
          "<same maxResultsPerSource value as the server-prepared payload, when present>",
        context:
          "<same context value as the server-prepared payload, when present>",
        planFingerprint: "<server-prepared plan fingerprint>",
        fingerprint: "<server-prepared fingerprint>",
        group: {
          id: "exact_or_structured",
          priority: 0,
          patternIds: ["p1"],
        },
        offset: 0,
        limit: 10,
      },
    };
  }
}

export function parseSearchSessionsInput(
  input: SearchSessionsToolInput
): SearchSessionsInput {
  const normalized = normalizeGroupCandidatesShorthand(input);
  validateGroupCandidatesFollowup(normalized);
  return stripContinuationShorthand(normalized) as SearchSessionsInput;
}

export async function runSearchSessionsTool(
  search: SessionSearch,
  input: SearchSessionsToolInput
) {
  const parsed = parseSearchSessionsInput(
    searchSessionsInputSchema.parse(input)
  );
  return search.searchSessions(parsed);
}

function validateGroupCandidatesFollowup(input: SearchSessionsToolInput) {
  const followup = input.groupCandidates;
  if (!followup) {
    return;
  }

  if (followup.query !== input.query) {
    throw new SearchSessionsInputError(
      "groupCandidates.query",
      "Invalid group follow-up: groupCandidates.query must match the top-level query copied from the server-prepared payload."
    );
  }
  if (
    input.queries !== undefined &&
    !stringArraysEqual(input.queries, followup.queries ?? [])
  ) {
    throw new SearchSessionsInputError(
      "queries",
      "Invalid group follow-up: top-level queries must match groupCandidates.queries from the server-prepared payload."
    );
  }
  if (
    input.sources !== undefined &&
    !sourcesEqual(input.sources, followup.sources)
  ) {
    throw new SearchSessionsInputError(
      "sources",
      "Invalid group follow-up: top-level sources must match groupCandidates.sources from the server-prepared payload."
    );
  }
  if (
    input.operationalContext !== undefined &&
    groupCandidatesFingerprint({
      ...followup,
      operationalContext: input.operationalContext,
    }) !== followup.fingerprint
  ) {
    throw new SearchSessionsInputError(
      "operationalContext",
      "Invalid group follow-up: top-level operationalContext must match groupCandidates.operationalContext from the server-prepared payload."
    );
  }
  if (
    input.callerSession !== undefined &&
    !callerSessionsEqual(input.callerSession, followup.callerSession)
  ) {
    throw new SearchSessionsInputError(
      "callerSession",
      "Invalid group follow-up: top-level callerSession must match groupCandidates.callerSession from the server-prepared payload."
    );
  }
  if (
    input.maxPatterns !== undefined &&
    input.maxPatterns !== followup.maxPatterns
  ) {
    throw new SearchSessionsInputError(
      "maxPatterns",
      "Invalid group follow-up: top-level maxPatterns must match groupCandidates.maxPatterns from the server-prepared payload."
    );
  }
  if (
    input.maxResultsPerSource !== undefined &&
    input.maxResultsPerSource !== followup.maxResultsPerSource
  ) {
    throw new SearchSessionsInputError(
      "maxResultsPerSource",
      "Invalid group follow-up: top-level maxResultsPerSource must match groupCandidates.maxResultsPerSource from the server-prepared payload."
    );
  }
  if (input.context !== undefined && input.context !== followup.context) {
    throw new SearchSessionsInputError(
      "context",
      "Invalid group follow-up: top-level context must match groupCandidates.context from the server-prepared payload."
    );
  }
  if (!groupCandidatesFingerprintIsValid(followup)) {
    throw new SearchSessionsInputError(
      "groupCandidates.fingerprint",
      "Invalid group follow-up: groupCandidates must be copied exactly from the server-prepared payload."
    );
  }
  if (
    input.resultsDisplayMode !== undefined &&
    input.resultsDisplayMode !== "candidates"
  ) {
    throw new SearchSessionsInputError(
      "resultsDisplayMode",
      'Invalid group follow-up: group candidate expansion must use resultsDisplayMode: "candidates".'
    );
  }
  if (
    input.paths !== undefined &&
    !stringArraysEqual(input.paths, followup.paths ?? [])
  ) {
    throw new SearchSessionsInputError(
      "paths",
      "Invalid group follow-up: use groupCandidates.paths from the server-prepared payload instead of a top-level paths field."
    );
  }
}

function normalizeGroupCandidatesShorthand(
  input: SearchSessionsToolInput
): SearchSessionsToolInput {
  if (input.groupCandidates) {
    return input;
  }

  const hasShorthand =
    input.planFingerprint !== undefined ||
    input.fingerprint !== undefined ||
    input.group !== undefined ||
    input.offset !== undefined ||
    input.limit !== undefined;
  if (!hasShorthand) {
    return input;
  }

  if (
    input.resultsDisplayMode !== undefined &&
    input.resultsDisplayMode !== "candidates"
  ) {
    throw new SearchSessionsInputError(
      "resultsDisplayMode",
      'Invalid group follow-up: group candidate shorthand must use resultsDisplayMode: "candidates".'
    );
  }

  if (
    input.planFingerprint === undefined ||
    input.fingerprint === undefined ||
    input.group === undefined ||
    input.offset === undefined ||
    input.limit === undefined
  ) {
    throw new SearchSessionsInputError(
      "groupCandidates",
      "Invalid group follow-up: pass a complete more.groupCandidates payload either under groupCandidates or as the top-level shorthand."
    );
  }

  return {
    ...input,
    resultsDisplayMode: "candidates",
    groupCandidates: {
      query: input.query,
      ...(input.queries ? { queries: input.queries } : {}),
      ...(input.operationalContext !== undefined
        ? { operationalContext: input.operationalContext }
        : {}),
      ...(input.callerSession !== undefined
        ? { callerSession: input.callerSession }
        : {}),
      ...(input.sources ? { sources: input.sources } : {}),
      resultsDisplayMode: "candidates",
      ...(input.paths ? { paths: input.paths } : {}),
      ...(input.maxPatterns !== undefined
        ? { maxPatterns: input.maxPatterns }
        : {}),
      ...(input.maxResultsPerSource !== undefined
        ? { maxResultsPerSource: input.maxResultsPerSource }
        : {}),
      ...(input.context !== undefined ? { context: input.context } : {}),
      planFingerprint: input.planFingerprint,
      fingerprint: input.fingerprint,
      group: input.group,
      offset: input.offset,
      limit: input.limit,
    },
  };
}

function stripContinuationShorthand(input: SearchSessionsToolInput) {
  const {
    planFingerprint: _planFingerprint,
    fingerprint: _fingerprint,
    group: _group,
    offset: _offset,
    limit: _limit,
    ...searchInput
  } = input;
  return searchInput;
}

function sourcesEqual(
  left: SearchSessionsToolInput["sources"],
  right: SearchSessionsToolInput["sources"]
) {
  if (left === right) {
    return true;
  }
  if (
    left === "all" ||
    right === "all" ||
    left === undefined ||
    right === undefined
  ) {
    return false;
  }
  return stringArraysEqual(left, right);
}

function callerSessionsEqual(
  left: SearchSessionsToolInput["callerSession"],
  right: SearchSessionsToolInput["callerSession"]
) {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.source === right.source && left.sessionId === right.sessionId;
}
