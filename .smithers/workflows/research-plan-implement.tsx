// smithers-source: seeded
// smithers-metadata-version: 1
// smithers-display-name: Research Plan Implement
// smithers-description: Research a request, produce a plan, then implement it with validation and review.
// smithers-tags: research, planning, coding
// smithers-aliases: rpi
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
import {
  ResearchContext,
  researchOutputSchema,
  researchProbeOutputSchema,
} from "../components/ResearchContext";
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
  tdd: z.boolean().default(false),
});

const { Workflow, Sequence, smithers } = createSmithers({
  input: inputSchema,
  researchProbe: researchProbeOutputSchema,
  research: researchOutputSchema,
  planContext: planContextOutputSchema,
  planCandidate: planCandidateOutputSchema,
  plan: planOutputSchema,
  implement: implementOutputSchema,
  validate: validateOutputSchema,
  reviewContext: reviewContextOutputSchema,
  reviewFinding: reviewFindingOutputSchema,
  review: reviewOutputSchema,
});

function formatResearchForPrompt(
  research: z.infer<typeof researchOutputSchema> | undefined
) {
  if (!research) return null;
  return [
    `RESEARCH FINDINGS:\n${research.summary}`,
    research.keyFindings.length
      ? `Key findings:\n${research.keyFindings.map((f) => `- ${f}`).join("\n")}`
      : null,
    research.files.length
      ? `Relevant files:\n${research.files.map((f) => `- ${f}`).join("\n")}`
      : null,
    research.risks.length
      ? `Risks:\n${research.risks.map((r) => `- ${r}`).join("\n")}`
      : null,
    research.openQuestions.length
      ? `Open questions:\n${research.openQuestions.map((q) => `- ${q}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatPlanForPrompt(
  plan: z.infer<typeof planOutputSchema> | undefined
) {
  if (!plan) return null;
  return [
    `IMPLEMENTATION PLAN:\n${plan.summary}`,
    plan.steps.length
      ? `Steps:\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
      : null,
    plan.files.length
      ? `Files:\n${plan.files.map((f) => `- ${f}`).join("\n")}`
      : null,
    plan.validation.length
      ? `Validation:\n${plan.validation.map((v) => `- ${v}`).join("\n")}`
      : null,
    plan.risks.length
      ? `Risks:\n${plan.risks.map((r) => `- ${r}`).join("\n")}`
      : null,
    plan.openQuestions.length
      ? `Open questions:\n${plan.openQuestions.map((q) => `- ${q}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export default smithers((ctx) => {
  const prompt = ctx.input.prompt;
  const tdd = ctx.input.tdd;

  const research = ctx.outputMaybe("research", { nodeId: "research" });
  const plan = ctx.outputMaybe("plan", { nodeId: "plan" });
  const researchPrompt = formatResearchForPrompt(research);
  const planResultPrompt = formatPlanForPrompt(plan);

  // Enrich plan prompt with research findings
  const planPromptParts = [
    prompt,
    researchPrompt,
    tdd
      ? "IMPORTANT: Write tests FIRST. The plan MUST start with test steps before any implementation steps. Follow test-driven development: define expected behavior in tests, then implement to make them pass."
      : null,
  ];
  const planPrompt = planPromptParts.filter(Boolean).join("\n\n---\n");

  // Enrich implement prompt with both research and plan
  const implementPrompt = [
    prompt,
    researchPrompt,
    planResultPrompt,
    tdd
      ? "IMPORTANT: Follow the plan's test-first approach. Write or update tests before implementing production code."
      : null,
  ]
    .filter(Boolean)
    .join("\n\n---\n");

  const gate = buildValidationReviewGate({
    validate: ctx.latest("validate", "impl:validate"),
    review: ctx.latest("review", reviewSynthesisNodeId("impl:review")),
  });

  return (
    <Workflow name="research-plan-implement">
      <Sequence>
        <ResearchContext
          prompt={prompt}
          probeAgent={agents.explorer}
          synthesisAgent={agents.explorerSynthesis}
        />
        <PlannerPanel
          prompt={planPrompt}
          contextAgent={agents.explorer}
          candidates={plannerPanel}
          synthesisAgent={agents.plannerSynthesis}
        />
        <ValidationLoop
          idPrefix="impl"
          prompt={implementPrompt}
          implementAgents={agents.engineer}
          validateAgents={agents.cheapFast}
          reviewContextAgent={agents.reviewContext}
          reviewAgents={agents.review}
          reviewSynthesisAgent={agents.reviewSynthesis}
          feedback={gate.feedback}
          done={gate.done}
          maxIterations={3}
        />
      </Sequence>
    </Workflow>
  );
});
