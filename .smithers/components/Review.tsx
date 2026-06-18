// smithers-source: seeded
/** @jsxImportSource smithers-orchestrator */
import {
  Parallel,
  Sequence,
  Task,
  type AgentLike,
} from "smithers-orchestrator";
import { z } from "zod/v4";
import ReviewContextPrompt from "../prompts/review-context.mdx";
import ReviewPrompt from "../prompts/review.mdx";
import ReviewSynthesisPrompt from "../prompts/review-synthesis.mdx";
export { formatReviewFeedback } from "./ValidationGate";

const reviewIssueSchema = z.object({
  severity: z.enum(["critical", "major", "minor", "nit"]),
  title: z.string(),
  file: z.string().nullable().default(null),
  description: z.string(),
});

export const reviewFindingOutputSchema = z.object({
  reviewer: z.string(),
  approved: z.boolean(),
  feedback: z.string(),
  issues: z.array(reviewIssueSchema).default([]),
});

export const reviewContextOutputSchema = z.object({
  summary: z.string(),
  focusAreas: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});

export const reviewOutputSchema = reviewFindingOutputSchema.extend({
  synthesizedFrom: z.array(z.string()).default([]),
  disagreements: z.array(z.string()).default([]),
});

export function reviewSynthesisNodeId(idPrefix: string) {
  return `${idPrefix}:synthesize`;
}

export type ReviewPanelAgents = [AgentLike, AgentLike, AgentLike];

type ReviewProps = {
  idPrefix: string;
  prompt: unknown;
  contextAgent: AgentLike | AgentLike[];
  agents: ReviewPanelAgents;
  synthesisAgent: AgentLike | AgentLike[];
};

const reviewerSlots = [0, 1, 2] as const;

function formatReviewContext(
  context: z.infer<typeof reviewContextOutputSchema>
) {
  return [
    `Summary: ${context.summary}`,
    "Focus areas:",
    context.focusAreas.length
      ? context.focusAreas.map((area) => `- ${area}`).join("\n")
      : "- none",
    "Evidence:",
    context.evidence.length
      ? context.evidence.map((item) => `- ${item}`).join("\n")
      : "- none",
  ].join("\n");
}

export function Review({
  idPrefix,
  prompt,
  contextAgent,
  agents,
  synthesisAgent,
}: ReviewProps) {
  const promptText =
    typeof prompt === "string" ? prompt : JSON.stringify(prompt ?? null);
  const contextTaskId = `${idPrefix}:context`;
  const reviewTaskIds = reviewerSlots.map((index) => `${idPrefix}:${index}`);
  const reviewNeeds = {
    review0: reviewTaskIds[0],
    review1: reviewTaskIds[1],
    review2: reviewTaskIds[2],
  };
  const reviewDeps = {
    review0: reviewFindingOutputSchema,
    review1: reviewFindingOutputSchema,
    review2: reviewFindingOutputSchema,
  };

  return (
    <Sequence>
      <Task
        id={contextTaskId}
        output="reviewContext"
        outputSchema={reviewContextOutputSchema}
        agent={contextAgent}
      >
        <ReviewContextPrompt prompt={promptText} />
      </Task>
      <Parallel>
        {reviewerSlots.map((index) => (
          <Task
            key={reviewTaskIds[index]}
            id={reviewTaskIds[index]}
            output="reviewFinding"
            outputSchema={reviewFindingOutputSchema}
            agent={agents[index]}
            needs={{ context: contextTaskId }}
            deps={{ context: reviewContextOutputSchema }}
          >
            {(deps) => (
              <ReviewPrompt
                reviewer={`reviewer-${index + 1}`}
                prompt={promptText}
                context={formatReviewContext(deps.context)}
              />
            )}
          </Task>
        ))}
      </Parallel>
      <Task
        id={reviewSynthesisNodeId(idPrefix)}
        output={reviewOutputSchema}
        agent={synthesisAgent}
        needs={{ context: contextTaskId, ...reviewNeeds }}
        deps={{ context: reviewContextOutputSchema, ...reviewDeps }}
      >
        {(deps) => {
          const reviewCount = reviewTaskIds.length;
          return (
            <ReviewSynthesisPrompt
              prompt={promptText}
              context={formatReviewContext(deps.context)}
              reviewerCount={reviewCount}
              reviews={[deps.review0, deps.review1, deps.review2]
                .map((review, index) => {
                  const issues = review.issues ?? [];
                  return [
                    `## Reviewer ${index + 1}: ${review.reviewer}`,
                    `Approved: ${review.approved}`,
                    `Feedback: ${review.feedback}`,
                    "Issues:",
                    issues.length
                      ? issues
                          .map(
                            (issue) =>
                              `- [${issue.severity}] ${issue.title}${issue.file ? ` (${issue.file})` : ""}: ${issue.description}`
                          )
                          .join("\n")
                      : "- none",
                  ].join("\n");
                })
                .join("\n\n")}
            />
          );
        }}
      </Task>
    </Sequence>
  );
}
