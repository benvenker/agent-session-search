import { z } from "zod";
import type { SearchSessionsInput, SessionSearch } from "./types.js";

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
      "Result detail level. Use candidates first, evidence with a candidate more.evidence follow-up, and debug only for diagnostics. Evidence without paths is capped by default."
    ),
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
      "Maximum number of results to return for each searched source. Useful for intentionally broad evidence searches."
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
    .describe("Include query expansion and backend diagnostics."),
});

export type SearchSessionsToolInput = z.infer<typeof searchSessionsInputSchema>;

export function parseSearchSessionsInput(
  input: SearchSessionsToolInput
): SearchSessionsInput {
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
