// smithers-source: seeded
// smithers-metadata-version: 1
// smithers-display-name: Improve Test Coverage
// smithers-description: Find and add high-impact missing tests for the current repository.
// smithers-tags: testing, quality
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
  prompt: z
    .string()
    .default("Improve the test coverage for the current repository."),
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
    validate: ctx.latest("validate", "improve-test-coverage:validate"),
    review: ctx.latest(
      "review",
      reviewSynthesisNodeId("improve-test-coverage:review")
    ),
  });

  return (
    <Workflow name="improve-test-coverage">
      <ValidationLoop
        idPrefix="improve-test-coverage"
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
