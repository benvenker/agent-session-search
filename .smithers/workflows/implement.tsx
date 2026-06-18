// smithers-source: seeded
// smithers-metadata-version: 1
// smithers-display-name: Implement
// smithers-description: Implement a focused change with validation and review feedback loops.
// smithers-tags: coding, implementation, review
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents } from "../agents";
import {
  ValidationLoop,
  buildValidationReviewGate,
  implementOutputSchema,
  validateOutputSchema,
} from "../components/ValidationLoop";
import {
  reviewContextOutputSchema,
  reviewFindingOutputSchema,
  reviewOutputSchema,
  reviewSynthesisNodeId,
} from "../components/Review";

const inputSchema = z.object({
  prompt: z.string().default("Implement the requested change."),
});

const { Workflow, smithers } = createSmithers({
  input: inputSchema,
  implement: implementOutputSchema,
  validate: validateOutputSchema,
  reviewContext: reviewContextOutputSchema,
  reviewFinding: reviewFindingOutputSchema,
  review: reviewOutputSchema,
});

export default smithers((ctx) => {
  const gate = buildValidationReviewGate({
    validate: ctx.latest("validate", "impl:validate"),
    review: ctx.latest("review", reviewSynthesisNodeId("impl:review")),
  });

  return (
    <Workflow name="implement">
      <ValidationLoop
        idPrefix="impl"
        prompt={ctx.input.prompt}
        implementAgents={agents.engineer}
        validateAgents={agents.cheapFast}
        reviewContextAgent={agents.reviewContext}
        reviewAgents={agents.review}
        reviewSynthesisAgent={agents.reviewSynthesis}
        feedback={gate.feedback}
        done={gate.done}
        maxIterations={3}
      />
    </Workflow>
  );
});
