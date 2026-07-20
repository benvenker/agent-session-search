import { z } from "zod";
import {
  groupCandidatesFingerprint,
  groupCandidatesFingerprintIsValid,
  stringArraysEqual,
} from "./followup.js";
import type {
  SearchSessionsInput,
  SearchSessionsTeachingError,
  SessionSearch,
} from "./types.js";

const workspaceFilterDescription =
  "Only include sessions associated with this workspace through physical path containment, an exact encoded-directory component (never a prefix), or recorded cwd/projectRoot metadata; workspace subdirectories are included. Relative paths resolve against the server process cwd, so MCP clients and shims should pass an absolute path.";

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
    days: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Only include sessions modified within this many days."),
    workspace: z
      .string()
      .min(1)
      .optional()
      .describe(workspaceFilterDescription),
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

const searchSessionsInputShape = {
  query: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Concise human-readable recall task. Required for new searches; complete more.groupCandidates replays may omit it because the payload carries the original query."
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
  days: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Only include sessions modified within this many days."),
  workspace: z.string().min(1).optional().describe(workspaceFilterDescription),
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
};

export const searchSessionsInputSchema = z
  .object(searchSessionsInputShape)
  .superRefine((input, context) => {
    if (input.query === undefined && input.groupCandidates === undefined) {
      context.addIssue({
        code: "custom",
        path: ["query"],
        message:
          "query is required unless replaying a complete more.groupCandidates payload under groupCandidates",
      });
    }
  })
  .meta({
    anyOf: [{ required: ["query"] }, { required: ["groupCandidates"] }],
  });

export type SearchSessionsToolInput = z.infer<typeof searchSessionsInputSchema>;

export class SearchSessionsInputError
  extends Error
  implements SearchSessionsTeachingError
{
  readonly code = "invalid_group_followup";
  readonly invalidField: string;
  readonly correctedShape: Record<string, unknown>;

  constructor(invalidField: string, message: string) {
    super(message);
    this.name = "SearchSessionsInputError";
    this.invalidField = invalidField;
    this.correctedShape = {
      groupCandidates: {
        query: "<same query copied from the server-prepared payload>",
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
        days: "<same days value as the server-prepared payload, when present>",
        workspace:
          "<same workspace value as the server-prepared payload, when present>",
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
  if (normalized.query === undefined) {
    throw new SearchSessionsInputError(
      "query",
      "Invalid search_sessions input: query is required unless replaying a complete more.groupCandidates payload under groupCandidates."
    );
  }
  validateGroupCandidatesFollowup(normalized);
  return stripContinuationShorthand(normalized) as SearchSessionsInput;
}

export async function runSearchSessionsTool(
  search: SessionSearch,
  input: unknown
) {
  const schemaResult = searchSessionsInputSchema.safeParse(input);
  if (!schemaResult.success) {
    const groupError = searchSessionsInputErrorFromSchema(schemaResult.error);
    if (groupError) {
      throw groupError;
    }
    throw schemaResult.error;
  }
  const parsed = parseSearchSessionsInput(schemaResult.data);
  return search.searchSessions(parsed);
}

function searchSessionsInputErrorFromSchema(error: z.ZodError) {
  const issues = flattenZodIssues(error.issues);
  const groupIssue =
    issues.find((issue: z.core.$ZodIssue) => {
      return issue.path?.[0] === "groupCandidates";
    }) ??
    issues.find((issue: z.core.$ZodIssue) => {
      return isGroupFollowupShorthandField(issue.path?.[0]);
    });
  if (!groupIssue) {
    return undefined;
  }
  const invalidField =
    groupIssue.path.length > 0 ? groupIssue.path.join(".") : "input";
  return new SearchSessionsInputError(
    invalidField,
    `Invalid group follow-up: ${invalidField} does not match the server-prepared group candidate payload shape. Copy more.groupCandidates exactly, or echo its shorthand fields exactly.`
  );
}

function flattenZodIssues(
  issues: readonly z.core.$ZodIssue[]
): z.core.$ZodIssue[] {
  return issues.flatMap((issue: z.core.$ZodIssue) => {
    if ("errors" in issue && Array.isArray(issue.errors)) {
      return [
        issue,
        ...flattenZodIssues(issue.errors.flat() as z.core.$ZodIssue[]),
      ];
    }
    return [issue];
  });
}

function isGroupFollowupShorthandField(field: PropertyKey | undefined) {
  return [
    "planFingerprint",
    "fingerprint",
    "group",
    "offset",
    "limit",
  ].includes(String(field));
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
  if (input.days !== undefined && input.days !== followup.days) {
    throw new SearchSessionsInputError(
      "days",
      "Invalid group follow-up: top-level days must match groupCandidates.days from the server-prepared payload."
    );
  }
  if (input.workspace !== undefined && input.workspace !== followup.workspace) {
    throw new SearchSessionsInputError(
      "workspace",
      "Invalid group follow-up: top-level workspace must match groupCandidates.workspace from the server-prepared payload."
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
  if (
    input.planFingerprint !== undefined &&
    input.planFingerprint !== followup.planFingerprint
  ) {
    throw new SearchSessionsInputError(
      "planFingerprint",
      "Invalid group follow-up: top-level planFingerprint must match groupCandidates.planFingerprint from the server-prepared payload."
    );
  }
  if (
    input.fingerprint !== undefined &&
    input.fingerprint !== followup.fingerprint
  ) {
    throw new SearchSessionsInputError(
      "fingerprint",
      "Invalid group follow-up: top-level fingerprint must match groupCandidates.fingerprint from the server-prepared payload."
    );
  }
  if (
    input.group !== undefined &&
    JSON.stringify(input.group) !== JSON.stringify(followup.group)
  ) {
    throw new SearchSessionsInputError(
      "group",
      "Invalid group follow-up: top-level group must match groupCandidates.group from the server-prepared payload."
    );
  }
  if (input.offset !== undefined && input.offset !== followup.offset) {
    throw new SearchSessionsInputError(
      "offset",
      "Invalid group follow-up: top-level offset must match groupCandidates.offset from the server-prepared payload."
    );
  }
  if (input.limit !== undefined && input.limit !== followup.limit) {
    throw new SearchSessionsInputError(
      "limit",
      "Invalid group follow-up: top-level limit must match groupCandidates.limit from the server-prepared payload."
    );
  }
}

function normalizeGroupCandidatesShorthand(
  input: SearchSessionsToolInput
): SearchSessionsToolInput {
  if (input.groupCandidates) {
    return {
      ...input,
      query: input.query ?? input.groupCandidates.query,
      queries: input.queries ?? input.groupCandidates.queries,
      sources: input.sources ?? input.groupCandidates.sources,
      resultsDisplayMode:
        input.resultsDisplayMode ?? input.groupCandidates.resultsDisplayMode,
      paths: input.paths ?? input.groupCandidates.paths,
      maxPatterns: input.maxPatterns ?? input.groupCandidates.maxPatterns,
      maxResultsPerSource:
        input.maxResultsPerSource ?? input.groupCandidates.maxResultsPerSource,
      context: input.context ?? input.groupCandidates.context,
      days: input.days ?? input.groupCandidates.days,
      workspace: input.workspace ?? input.groupCandidates.workspace,
      ...(input.operationalContext === undefined &&
      input.groupCandidates.operationalContext !== undefined
        ? { operationalContext: input.groupCandidates.operationalContext }
        : {}),
      ...(input.callerSession === undefined &&
      input.groupCandidates.callerSession !== undefined
        ? { callerSession: input.groupCandidates.callerSession }
        : {}),
    };
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

  if (input.query === undefined) {
    throw new SearchSessionsInputError(
      "query",
      "Invalid group follow-up: top-level shorthand must include query, or pass the complete more.groupCandidates payload under groupCandidates."
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
      ...(input.days !== undefined ? { days: input.days } : {}),
      ...(input.workspace !== undefined ? { workspace: input.workspace } : {}),
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
