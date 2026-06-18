// smithers-source: seeded
// smithers-metadata-version: 1
// smithers-display-name: Review
// smithers-description: Review current repository changes with one or more configured agents.
// smithers-tags: review, quality
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents } from "../agents";
import {
  Review,
  reviewContextOutputSchema,
  reviewFindingOutputSchema,
  reviewOutputSchema,
} from "../components/Review";

const inputSchema = z.object({
  prompt: z.string().default("Review the current repository changes."),
});

const { Workflow, smithers } = createSmithers({
  input: inputSchema,
  reviewContext: reviewContextOutputSchema,
  reviewFinding: reviewFindingOutputSchema,
  review: reviewOutputSchema,
});

export default smithers((ctx) => (
  <Workflow name="review">
    <Review
      idPrefix="review"
      prompt={ctx.input.prompt}
      contextAgent={agents.reviewContext}
      agents={agents.review}
      synthesisAgent={agents.reviewSynthesis}
    />
  </Workflow>
));
