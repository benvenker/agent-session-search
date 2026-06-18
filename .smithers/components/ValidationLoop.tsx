// smithers-source: seeded
/** @jsxImportSource smithers-orchestrator */
import { Sequence, Loop, Task, type AgentLike } from "smithers-orchestrator";
import { z } from "zod/v4";
import { Review, type ReviewPanelAgents } from "~/components/Review";
export {
  buildValidationReviewGate,
  formatReviewFeedback,
} from "~/components/ValidationGate";
import ImplementPrompt from "~/prompts/implement.mdx";
import ValidatePrompt from "~/prompts/validate.mdx";

export const implementOutputSchema = z.object({
  summary: z.string(),
  filesChanged: z.array(z.string()).default([]),
  allTestsPassing: z.boolean().default(true),
});
export const validateOutputSchema = z.object({
  summary: z.string(),
  allPassed: z.boolean().default(true),
  failingSummary: z.string().nullable().default(null),
});

export type ValidationLoopProps = {
  idPrefix: string;
  prompt: unknown;
  implementAgents: AgentLike[];
  reviewAgents: ReviewPanelAgents;
  reviewContextAgent?: AgentLike | AgentLike[];
  reviewSynthesisAgent: AgentLike | AgentLike[];
  validateAgents?: AgentLike[];
  feedback?: string | null;
  done?: boolean;
  maxIterations?: number;
};

export function ValidationLoop({
  idPrefix,
  prompt,
  implementAgents,
  reviewAgents,
  reviewContextAgent,
  reviewSynthesisAgent,
  validateAgents,
  feedback,
  done = false,
  maxIterations = 3,
}: ValidationLoopProps) {
  const promptText =
    typeof prompt === "string" ? prompt : JSON.stringify(prompt ?? null);
  return (
    <Loop
      id={`${idPrefix}:loop`}
      until={done}
      maxIterations={maxIterations}
      onMaxReached="return-last"
    >
      <Sequence>
        <Task
          id={`${idPrefix}:implement`}
          output={implementOutputSchema}
          agent={implementAgents}
          timeoutMs={1_800_000}
          heartbeatTimeoutMs={600_000}
        >
          <ImplementPrompt
            prompt={
              feedback
                ? `${promptText}\n\n---\nPREVIOUS ATTEMPT FEEDBACK (fix these issues):\n${feedback}`
                : promptText
            }
          />
        </Task>
        <Task
          id={`${idPrefix}:validate`}
          output={validateOutputSchema}
          agent={
            validateAgents && validateAgents.length > 0
              ? validateAgents
              : implementAgents
          }
          timeoutMs={1_800_000}
          heartbeatTimeoutMs={600_000}
        >
          <ValidatePrompt prompt={promptText} />
        </Task>
        <Review
          idPrefix={`${idPrefix}:review`}
          prompt={promptText}
          contextAgent={reviewContextAgent ?? reviewSynthesisAgent}
          agents={reviewAgents}
          synthesisAgent={reviewSynthesisAgent}
        />
      </Sequence>
    </Loop>
  );
}
