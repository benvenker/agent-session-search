// smithers-source: seeded
// smithers-metadata-version: 1
// smithers-display-name: Research
// smithers-description: Gather repository and external context before planning or building.
// smithers-tags: research
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents } from "../agents";
import {
  ResearchContext,
  researchOutputSchema,
  researchProbeOutputSchema,
} from "../components/ResearchContext";

const inputSchema = z.object({
  prompt: z.string().default("Research the given topic."),
});

const { Workflow, smithers } = createSmithers({
  input: inputSchema,
  researchProbe: researchProbeOutputSchema,
  research: researchOutputSchema,
});

export default smithers((ctx) => (
  <Workflow name="research">
    <ResearchContext
      prompt={ctx.input.prompt}
      probeAgent={agents.explorer}
      synthesisAgent={agents.explorerSynthesis}
    />
  </Workflow>
));
