// smithers-source: seeded
// smithers-metadata-version: 1
// smithers-display-name: Design Critique
// smithers-description: Run a bounded architecture/design critique with synthesis.
// smithers-tags: design, planning, review
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents } from "../agents";
import {
  DesignCritique,
  designCritiqueFindingOutputSchema,
  designCritiqueOutputSchema,
} from "../components/DesignCritique";

const inputSchema = z.object({
  prompt: z.string().default("Critique this design or plan."),
  artifactPath: z.string().nullable().default(null),
  additionalContext: z.string().nullable().default(null),
  maxConcurrency: z.number().int().positive().max(2).default(2),
});

const { Workflow, smithers } = createSmithers({
  input: inputSchema,
  designCritiqueFinding: designCritiqueFindingOutputSchema,
  designCritique: designCritiqueOutputSchema,
});

export default smithers((ctx) => (
  <Workflow name="design-critique">
    <DesignCritique
      idPrefix="design-critique"
      prompt={ctx.input.prompt}
      artifactPath={ctx.input.artifactPath}
      additionalContext={ctx.input.additionalContext}
      agents={agents.design}
      synthesisAgent={agents.designSynthesis}
      maxConcurrency={ctx.input.maxConcurrency}
    />
  </Workflow>
));
