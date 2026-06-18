// smithers-source: seeded
// smithers-metadata-version: 1
// smithers-display-name: Plan
// smithers-description: Create a practical implementation plan before code changes begin.
// smithers-tags: planning
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents, plannerPanel } from "../agents";
import {
  PlannerPanel,
  planCandidateOutputSchema,
  planContextOutputSchema,
  planOutputSchema,
} from "../components/PlannerPanel";

const inputSchema = z.object({
  prompt: z.string().default("Create an implementation plan."),
});

const { Workflow, smithers } = createSmithers({
  input: inputSchema,
  planContext: planContextOutputSchema,
  planCandidate: planCandidateOutputSchema,
  plan: planOutputSchema,
});

export default smithers((ctx) => (
  <Workflow name="plan">
    <PlannerPanel
      prompt={ctx.input.prompt}
      contextAgent={agents.explorer}
      candidates={plannerPanel}
      synthesisAgent={agents.plannerSynthesis}
    />
  </Workflow>
));
