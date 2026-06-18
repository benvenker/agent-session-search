// smithers-source: seeded
/** @jsxImportSource smithers-orchestrator */
import {
  Parallel,
  Sequence,
  Task,
  type AgentLike,
} from "smithers-orchestrator";
import { z } from "zod/v4";
import DesignCritiquePrompt from "../prompts/design-critique.mdx";
import DesignCritiqueSynthesisPrompt from "../prompts/design-critique-synthesis.mdx";

const designFindingSchema = z.object({
  severity: z.enum(["blocking", "major", "minor"]),
  title: z.string(),
  description: z.string(),
  file: z.string().nullable().default(null),
});

export const designCritiqueFindingOutputSchema = z.object({
  reviewer: z.string(),
  summary: z.string(),
  readyToProceed: z.boolean(),
  findings: z.array(designFindingSchema).default([]),
  questionsThatChangeOrder: z.array(z.string()).default([]),
  scopeExpansionRejected: z.array(z.string()).default([]),
});

export const designCritiqueOutputSchema =
  designCritiqueFindingOutputSchema.extend({
    synthesizedFrom: z.array(z.string()).default([]),
  });

type DesignCritiqueProps = {
  idPrefix: string;
  prompt: unknown;
  artifactPath?: string | null;
  additionalContext?: string | null;
  agents: AgentLike[];
  synthesisAgent: AgentLike | AgentLike[];
  maxConcurrency?: number;
};

function formatCritique(
  critique: z.infer<typeof designCritiqueFindingOutputSchema>,
  index: number
) {
  return [
    `## Critic ${index + 1}: ${critique.reviewer}`,
    `Ready to proceed: ${critique.readyToProceed}`,
    `Summary: ${critique.summary}`,
    "Findings:",
    critique.findings.length
      ? critique.findings
          .map(
            (finding) =>
              `- [${finding.severity}] ${finding.title}${finding.file ? ` (${finding.file})` : ""}: ${finding.description}`
          )
          .join("\n")
      : "- none",
    "Questions that change order:",
    critique.questionsThatChangeOrder.length
      ? critique.questionsThatChangeOrder.map((item) => `- ${item}`).join("\n")
      : "- none",
    "Scope expansion rejected:",
    critique.scopeExpansionRejected.length
      ? critique.scopeExpansionRejected.map((item) => `- ${item}`).join("\n")
      : "- none",
  ].join("\n");
}

export function DesignCritique({
  idPrefix,
  prompt,
  artifactPath,
  additionalContext,
  agents,
  synthesisAgent,
  maxConcurrency = 2,
}: DesignCritiqueProps) {
  const promptText =
    typeof prompt === "string" ? prompt : JSON.stringify(prompt ?? null);
  const criticIds = agents.map((_, index) => `${idPrefix}:${index}`);
  const needs = Object.fromEntries(
    criticIds.map((taskId, index) => [`critique${index}`, taskId])
  );
  const deps = Object.fromEntries(
    criticIds.map((_, index) => [
      `critique${index}`,
      designCritiqueFindingOutputSchema,
    ])
  );

  return (
    <Sequence>
      <Parallel maxConcurrency={maxConcurrency}>
        {agents.map((agent, index) => (
          <Task
            key={criticIds[index]}
            id={criticIds[index]}
            output="designCritiqueFinding"
            outputSchema={designCritiqueFindingOutputSchema}
            agent={agent}
            label={`Design critic ${index + 1}`}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
          >
            <DesignCritiquePrompt
              prompt={promptText}
              artifactPath={artifactPath ?? "not provided"}
              additionalContext={additionalContext ?? "not provided"}
            />
          </Task>
        ))}
      </Parallel>
      <Task
        id={`${idPrefix}:synthesize`}
        output={designCritiqueOutputSchema}
        agent={synthesisAgent}
        needs={needs}
        deps={deps}
        timeoutMs={1_800_000}
        heartbeatTimeoutMs={600_000}
      >
        {(resolvedDeps) => (
          <DesignCritiqueSynthesisPrompt
            prompt={promptText}
            critiques={criticIds
              .map((_, index) => resolvedDeps[`critique${index}`])
              .map(formatCritique)
              .join("\n\n")}
          />
        )}
      </Task>
    </Sequence>
  );
}
