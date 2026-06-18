// smithers-source: seeded
// smithers-metadata-version: 1
// smithers-display-name: Debug
// smithers-description: Reproduce, fix, validate, and review a reported bug.
// smithers-tags: debugging, testing
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
  prompt: z.string().default("Reproduce and fix the reported bug."),
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
    validate: ctx.latest("validate", "debug:validate"),
    review: ctx.latest("review", reviewSynthesisNodeId("debug:review")),
  });

  return (
    <Workflow name="debug">
      <ValidationLoop
        idPrefix="debug"
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
