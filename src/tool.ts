import { z } from "zod";
import type { SearchSessionsInput, SessionSearch } from "./types.js";

export const searchSessionsInputSchema = z.object({
  query: z.string().min(1),
  queries: z.array(z.string().min(1)).optional(),
  operationalContext: z.unknown().optional(),
  sources: z.union([z.array(z.string()), z.literal("all")]).optional(),
  maxPatterns: z.number().int().positive().optional(),
  maxResultsPerSource: z.number().int().positive().optional(),
  context: z.number().int().min(0).optional(),
  debug: z.boolean().optional(),
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
