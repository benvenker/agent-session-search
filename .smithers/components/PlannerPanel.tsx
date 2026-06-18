// smithers-source: seeded
/** @jsxImportSource smithers-orchestrator */
import {
  Parallel,
  Sequence,
  Task,
  type AgentLike,
} from "smithers-orchestrator";
import { z } from "zod/v4";
import PlanCandidatePrompt from "../prompts/plan-candidate.mdx";
import PlanContextProbePrompt from "../prompts/plan-context-probe.mdx";
import PlanSynthesisPrompt from "../prompts/plan-synthesis.mdx";

export const planContextOutputSchema = z.object({
  perspective: z.string(),
  summary: z.string(),
  evidence: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

export const planCandidateOutputSchema = z.object({
  author: z.string(),
  summary: z.string(),
  steps: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  validation: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

export const planOutputSchema = z.object({
  summary: z.string(),
  steps: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  validation: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

export type PlannerCandidate = {
  id: "codex" | "opus";
  label: string;
  agent: AgentLike | AgentLike[];
};

const contextProbes = [
  {
    id: "seams",
    label: "Seams",
    prompt:
      "Identify the codebase seams, files, interfaces, tests, and existing patterns that should shape this plan.",
  },
  {
    id: "prior-art",
    label: "Prior art",
    prompt:
      "Find prior docs, plans, ADRs, comments, similar implementations, or relevant external docs that should constrain the plan.",
  },
  {
    id: "risks",
    label: "Risks",
    prompt:
      "Identify likely risks, validation commands, edge cases, and open questions that would change implementation order.",
  },
] as const;

type PlannerPanelProps = {
  idPrefix?: string;
  prompt: unknown;
  contextAgent: AgentLike | AgentLike[];
  candidates: readonly [PlannerCandidate, PlannerCandidate];
  synthesisAgent: AgentLike | AgentLike[];
};

export function PlannerPanel({
  idPrefix = "plan",
  prompt,
  contextAgent,
  candidates,
  synthesisAgent,
}: PlannerPanelProps) {
  const promptText =
    typeof prompt === "string" ? prompt : JSON.stringify(prompt ?? null);

  return (
    <Sequence>
      <Parallel maxConcurrency={3}>
        {contextProbes.map((probe) => (
          <Task
            key={probe.id}
            id={`${idPrefix}:context:${probe.id}`}
            output={planContextOutputSchema}
            agent={contextAgent}
            label={probe.label}
            timeoutMs={900_000}
            heartbeatTimeoutMs={300_000}
          >
            <PlanContextProbePrompt prompt={promptText} probe={probe.prompt} />
          </Task>
        ))}
      </Parallel>
      <Parallel maxConcurrency={2}>
        {candidates.map((candidate) => (
          <Task
            key={candidate.id}
            id={`${idPrefix}:candidate:${candidate.id}`}
            output={planCandidateOutputSchema}
            agent={candidate.agent}
            label={candidate.label}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
            needs={{
              seams: `${idPrefix}:context:seams`,
              priorArt: `${idPrefix}:context:prior-art`,
              risks: `${idPrefix}:context:risks`,
            }}
            deps={{
              seams: planContextOutputSchema,
              priorArt: planContextOutputSchema,
              risks: planContextOutputSchema,
            }}
          >
            {(deps) => (
              <PlanCandidatePrompt
                prompt={promptText}
                context={JSON.stringify(deps, null, 2)}
              />
            )}
          </Task>
        ))}
      </Parallel>
      <Task
        id={idPrefix}
        output={planOutputSchema}
        agent={synthesisAgent}
        timeoutMs={1_800_000}
        heartbeatTimeoutMs={600_000}
        needs={{
          seams: `${idPrefix}:context:seams`,
          priorArt: `${idPrefix}:context:prior-art`,
          risks: `${idPrefix}:context:risks`,
          codex: `${idPrefix}:candidate:codex`,
          opus: `${idPrefix}:candidate:opus`,
        }}
        deps={{
          seams: planContextOutputSchema,
          priorArt: planContextOutputSchema,
          risks: planContextOutputSchema,
          codex: planCandidateOutputSchema,
          opus: planCandidateOutputSchema,
        }}
      >
        {(deps) => (
          <PlanSynthesisPrompt
            prompt={promptText}
            context={JSON.stringify(
              {
                seams: deps.seams,
                priorArt: deps.priorArt,
                risks: deps.risks,
              },
              null,
              2
            )}
            candidates={JSON.stringify(
              {
                codex: deps.codex,
                opus: deps.opus,
              },
              null,
              2
            )}
          />
        )}
      </Task>
    </Sequence>
  );
}
