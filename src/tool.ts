import { z } from "zod";
import type { SearchSessionsInput, SessionSearch } from "./types.js";

const matchGroupIdSchema = z.enum([
  "exact_or_structured",
  "phrase_or_adjacent_terms",
  "multi_term_coverage",
  "distinctive_term",
  "loose_fallback",
]);

const groupCandidatesFollowupSchema = z
  .object({
    query: z.string().min(1),
    queries: z.array(z.string().min(1)).optional(),
    sources: z.union([z.array(z.string()), z.literal("all")]).optional(),
    resultsDisplayMode: z.literal("candidates"),
    paths: z.array(z.string().min(1)).optional(),
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
      sources: ["<same source names as the original response>"],
      resultsDisplayMode: "candidates",
      group: {
        id: "exact_or_structured",
        priority: 0,
        patternIds: ["p1"],
      },
      offset: 0,
      limit: 10,
    };
  }
}

export function parseSearchSessionsInput(
  input: SearchSessionsToolInput
): SearchSessionsInput {
  validateGroupCandidatesFollowup(input);
  return input as SearchSessionsInput;
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
    input.resultsDisplayMode !== undefined &&
    input.resultsDisplayMode !== "candidates"
  ) {
    throw new SearchSessionsInputError(
      "resultsDisplayMode",
      'Invalid group follow-up: group candidate expansion must use resultsDisplayMode: "candidates".'
    );
  }
  if (input.paths !== undefined) {
    throw new SearchSessionsInputError(
      "paths",
      "Invalid group follow-up: use groupCandidates.paths from the server-prepared payload instead of a top-level paths field."
    );
  }
}
