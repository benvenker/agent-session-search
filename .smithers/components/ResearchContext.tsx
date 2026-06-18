// smithers-source: seeded
/** @jsxImportSource smithers-orchestrator */
import {
  Parallel,
  Sequence,
  Task,
  type AgentLike,
} from "smithers-orchestrator";
import { z } from "zod/v4";
import ResearchProbePrompt from "../prompts/research-probe.mdx";
import ResearchSynthesizePrompt from "../prompts/research-synthesize.mdx";

export const researchProbeOutputSchema = z.object({
  perspective: z.string(),
  summary: z.string(),
  findings: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

export const researchOutputSchema = z.object({
  summary: z.string(),
  keyFindings: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

const researchProbes = [
  {
    id: "codebase",
    label: "Codebase seams",
    prompt:
      "Map the in-repository surface area: likely files, symbols, workflows, tests, ownership boundaries, and conventions that matter.",
  },
  {
    id: "prior-art",
    label: "Prior art and docs",
    prompt:
      "Find relevant existing docs, plans, ADRs, comments, examples, issue notes, and external docs only when they are directly needed.",
  },
  {
    id: "risks-tests",
    label: "Risks and tests",
    prompt:
      "Identify validation strategy, likely tests or commands, edge cases, migration risks, and places where a cheap implementation could be wrong.",
  },
] as const;

type ResearchContextProps = {
  idPrefix?: string;
  prompt: unknown;
  probeAgent: AgentLike | AgentLike[];
  synthesisAgent: AgentLike | AgentLike[];
};

export function ResearchContext({
  idPrefix = "research",
  prompt,
  probeAgent,
  synthesisAgent,
}: ResearchContextProps) {
  const promptText =
    typeof prompt === "string" ? prompt : JSON.stringify(prompt ?? null);

  return (
    <Sequence>
      <Parallel maxConcurrency={3}>
        {researchProbes.map((probe) => (
          <Task
            key={probe.id}
            id={`${idPrefix}:${probe.id}`}
            output={researchProbeOutputSchema}
            agent={probeAgent}
            label={probe.label}
            timeoutMs={900_000}
            heartbeatTimeoutMs={300_000}
          >
            <ResearchProbePrompt prompt={promptText} probe={probe.prompt} />
          </Task>
        ))}
      </Parallel>
      <Task
        id={idPrefix}
        output={researchOutputSchema}
        agent={synthesisAgent}
        needs={{
          codebase: `${idPrefix}:codebase`,
          priorArt: `${idPrefix}:prior-art`,
          risksTests: `${idPrefix}:risks-tests`,
        }}
        deps={{
          codebase: researchProbeOutputSchema,
          priorArt: researchProbeOutputSchema,
          risksTests: researchProbeOutputSchema,
        }}
      >
        {(deps) => (
          <ResearchSynthesizePrompt
            prompt={promptText}
            results={JSON.stringify(deps, null, 2)}
          />
        )}
      </Task>
    </Sequence>
  );
}
