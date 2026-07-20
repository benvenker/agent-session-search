// smithers-source: seeded
// smithers-display-name: Plan Council
/** @jsxImportSource smithers-orchestrator */
import {
  accessSync,
  constants,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { providers } from "../agents";
import PlanCouncilDraftPrompt from "../prompts/plan-council-draft.mdx";
import PlanCouncilReviewPrompt from "../prompts/plan-council-review.mdx";
import PlanCouncilRevisePrompt from "../prompts/plan-council-revise.mdx";
import PlanCouncilSynthesisPrompt from "../prompts/plan-council-synthesis.mdx";

const DEFAULT_CONCEPT_PATH =
  "docs/plans/2026-07-20-001-feat-cass-compat-shim-plan.md";
const PLAN_COUNCIL_DIR =
  "docs/investigations/cm-decoupling/plan-council-cass-shim";
const MATERIALIZED_CONCEPT_PATH = `${PLAN_COUNCIL_DIR}/input-concept.md`;
const PLAN_PREFIX = "2026-07-20-";
const PLAN_SLUG = "feat-cass-compat-shim-plan";
const PLAN_DIR = "docs/plans";

const inputSchema = z.object({
  prompt: z.string().optional().default(DEFAULT_CONCEPT_PATH),
});

const resolveConceptOutputSchema = z.object({
  conceptPath: z.string(),
  conceptAbsolutePath: z.string(),
  conceptSourceKind: z.enum(["file", "free-text"]),
  summary: z.string(),
});

// The workflow owns the final plan path, computed once by a deterministic
// task. Agents only write to it; downstream tasks never trust agent-reported
// path metadata (two separate planners reported wrong paths in practice).
const resolvePlanPathOutputSchema = z.object({
  planPath: z.string(),
  sequence: z.number().int().min(1),
});

const draftOutputSchema = z.object({
  author: z.string(),
  draftPath: z.string(),
  summary: z.string(),
  keyDecisions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});

const synthesisOutputSchema = z.object({
  planPath: z.string(),
  sequence: z.number().int().min(1),
  summary: z.string(),
  frontmatterVerified: z.boolean(),
  draftsUsed: z.array(z.string()).default([]),
});

const reviewIssueSchema = z.object({
  severity: z.string(),
  title: z.string(),
  file: z.string().nullable().default(null),
  line: z.union([z.number(), z.string()]).nullable().default(null),
  description: z.string(),
  suggestedFix: z.string().nullable().default(null),
});

const reviewOutputSchema = z.object({
  approved: z.boolean(),
  summary: z.string(),
  issues: z.array(reviewIssueSchema).default([]),
  feedback: z.string(),
});

const revisionOutputSchema = z.object({
  planPath: z.string(),
  summary: z.string(),
  changes: z.array(z.string()).default([]),
  remainingIssues: z.array(z.string()).default([]),
});

const loopStateOutputSchema = z.object({
  planPath: z.string(),
  summary: z.string(),
  approved: z.boolean(),
  iterations: z.number().int().min(0),
});

const finalOutputSchema = z.object({
  planPath: z.string(),
  summary: z.string(),
  approved: z.boolean(),
  iterations: z.number().int().min(0),
});

const { Workflow, Task, Sequence, Parallel, Branch, Loop, smithers, outputs } =
  createSmithers({
    input: inputSchema,
    resolveConcept: resolveConceptOutputSchema,
    resolvePlanPath: resolvePlanPathOutputSchema,
    draft: draftOutputSchema,
    synthesis: synthesisOutputSchema,
    review: reviewOutputSchema,
    revision: revisionOutputSchema,
    loopState: loopStateOutputSchema,
    final: finalOutputSchema,
  });

type SynthesisOutput = z.infer<typeof synthesisOutputSchema>;
type ReviewOutput = z.infer<typeof reviewOutputSchema>;
type RevisionOutput = z.infer<typeof revisionOutputSchema>;

function repoRoot() {
  return process.cwd();
}

function toAbsolute(candidate: string) {
  return path.isAbsolute(candidate)
    ? candidate
    : path.resolve(repoRoot(), candidate);
}

function toRepoRelative(absolutePath: string) {
  const relative = path.relative(repoRoot(), absolutePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }
  return absolutePath;
}

function isReadableFile(absolutePath: string) {
  try {
    accessSync(absolutePath, constants.R_OK);
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

function resolveConceptPrompt(prompt: string) {
  const trimmed = prompt.trim() || DEFAULT_CONCEPT_PATH;
  const candidateAbsolutePath = toAbsolute(trimmed);

  if (isReadableFile(candidateAbsolutePath)) {
    const conceptPath = toRepoRelative(candidateAbsolutePath);
    return {
      conceptPath,
      conceptAbsolutePath: candidateAbsolutePath,
      conceptSourceKind: "file" as const,
      summary: `Using readable concept file ${conceptPath}.`,
    };
  }

  const conceptAbsolutePath = toAbsolute(MATERIALIZED_CONCEPT_PATH);
  mkdirSync(path.dirname(conceptAbsolutePath), { recursive: true });
  writeFileSync(
    conceptAbsolutePath,
    [
      "---",
      "sourceKind: free-text",
      `materializedAt: ${new Date().toISOString()}`,
      `originalPromptJson: ${JSON.stringify(trimmed)}`,
      "---",
      "",
      "# Plan Council Input Concept",
      "",
      "## Original Prompt",
      "",
      "```text",
      trimmed.replaceAll("```", "'''"),
      "```",
      "",
    ].join("\n")
  );

  return {
    conceptPath: MATERIALIZED_CONCEPT_PATH,
    conceptAbsolutePath,
    conceptSourceKind: "free-text" as const,
    summary: `Materialized free-text concept input to ${MATERIALIZED_CONCEPT_PATH}.`,
  };
}

function nextPlanPathHint() {
  const planDirAbsolute = toAbsolute(PLAN_DIR);
  let maxSequence = 0;

  try {
    for (const entry of readdirSync(planDirAbsolute)) {
      const match = entry.match(
        new RegExp(`^${PLAN_PREFIX}(\\d{3})-${PLAN_SLUG}\\.md$`)
      );
      if (match) {
        maxSequence = Math.max(maxSequence, Number(match[1]));
      }
    }
  } catch {
    maxSequence = 0;
  }

  const sequence = maxSequence + 1;
  const padded = String(sequence).padStart(3, "0");
  return {
    planPath: `${PLAN_DIR}/${PLAN_PREFIX}${padded}-${PLAN_SLUG}.md`,
    sequence,
  };
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function latestPlanPath({
  synthesis,
  revision,
}: {
  synthesis?: SynthesisOutput;
  revision?: RevisionOutput;
}) {
  return revision?.planPath ?? synthesis?.planPath ?? "";
}

function finalSummary({
  synthesis,
  review,
  revision,
}: {
  synthesis?: SynthesisOutput;
  review?: ReviewOutput;
  revision?: RevisionOutput;
}) {
  if (review?.approved) {
    return review.summary;
  }
  if (revision) {
    return `${revision.summary} Latest review did not approve the plan.`;
  }
  return synthesis?.summary ?? "Plan council did not produce a plan.";
}

export default smithers((ctx) => {
  const concept = ctx.outputMaybe("resolveConcept", {
    nodeId: "resolve-concept",
  });
  const resolvedPlanPath = ctx.outputMaybe("resolvePlanPath", {
    nodeId: "resolve-plan-path",
  });
  const kimiDraft = ctx.outputMaybe("draft", { nodeId: "draft-kimi-k3" });
  const codexDraft = ctx.outputMaybe("draft", {
    nodeId: "draft-codex-56-sol-x-high",
  });
  const fableDraft = ctx.outputMaybe("draft", { nodeId: "draft-fable" });
  const synthesis = ctx.outputMaybe("synthesis", {
    nodeId: "synthesize-plan",
  });
  const latestReview = ctx.latest("review", "review-plan");
  const latestRevision = ctx.latest("revision", "revise-plan");
  const latestLoopState = ctx.latest("loopState", "keep-approved-plan");
  const reviewIterations = ctx.outputs.review?.length ?? 0;
  const reviewApproved = latestReview?.approved === true;
  const loopDone = latestLoopState?.approved === true;
  const canRevise =
    latestReview !== undefined && !reviewApproved && reviewIterations < 3;
  const loopFinished =
    loopDone || (latestReview !== undefined && reviewIterations >= 3);
  const currentPlanPath =
    resolvedPlanPath?.planPath ??
    latestPlanPath({
      synthesis,
      revision: latestRevision,
    });

  return (
    <Workflow name="cass-shim-plan-council">
      <Sequence>
        <Task
          id="resolve-concept"
          output={outputs.resolveConcept}
          outputSchema={resolveConceptOutputSchema}
        >
          {async () =>
            resolveConceptPrompt(ctx.input.prompt ?? DEFAULT_CONCEPT_PATH)
          }
        </Task>

        <Task
          id="resolve-plan-path"
          output={outputs.resolvePlanPath}
          outputSchema={resolvePlanPathOutputSchema}
        >
          {async () => nextPlanPathHint()}
        </Task>

        <Parallel id="planner-drafts" maxConcurrency={3}>
          <Task
            id="draft-kimi-k3"
            output={outputs.draft}
            outputSchema={draftOutputSchema}
            agent={providers.kimiK3}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
            needs={{ concept: "resolve-concept" }}
            deps={{ concept: resolveConceptOutputSchema }}
          >
            {(deps) => (
              <PlanCouncilDraftPrompt
                author="kimi-k3"
                draftPath={`${PLAN_COUNCIL_DIR}/draft-kimi-k3.md`}
                concept={formatJson(deps.concept)}
              />
            )}
          </Task>
          <Task
            id="draft-codex-56-sol-x-high"
            output={outputs.draft}
            outputSchema={draftOutputSchema}
            agent={providers.codex56SolXHigh}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
            needs={{ concept: "resolve-concept" }}
            deps={{ concept: resolveConceptOutputSchema }}
          >
            {(deps) => (
              <PlanCouncilDraftPrompt
                author="codex-56-sol-x-high"
                draftPath={`${PLAN_COUNCIL_DIR}/draft-codex-56-sol-x-high.md`}
                concept={formatJson(deps.concept)}
              />
            )}
          </Task>
          <Task
            id="draft-fable"
            output={outputs.draft}
            outputSchema={draftOutputSchema}
            agent={providers.fable}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
            needs={{ concept: "resolve-concept" }}
            deps={{ concept: resolveConceptOutputSchema }}
          >
            {(deps) => (
              <PlanCouncilDraftPrompt
                author="fable"
                draftPath={`${PLAN_COUNCIL_DIR}/draft-fable.md`}
                concept={formatJson(deps.concept)}
              />
            )}
          </Task>
        </Parallel>

        <Task
          id="synthesize-plan"
          output={outputs.synthesis}
          outputSchema={synthesisOutputSchema}
          agent={providers.kimiK3}
          timeoutMs={1_800_000}
          heartbeatTimeoutMs={600_000}
          needs={{
            concept: "resolve-concept",
            kimi: "draft-kimi-k3",
            codex: "draft-codex-56-sol-x-high",
            fable: "draft-fable",
          }}
          deps={{
            concept: resolveConceptOutputSchema,
            kimi: draftOutputSchema,
            codex: draftOutputSchema,
            fable: draftOutputSchema,
          }}
        >
          {(deps) => (
            <PlanCouncilSynthesisPrompt
              concept={formatJson(deps.concept)}
              drafts={formatJson({
                // Canonical draft paths are deterministic constants; never
                // trust agent-reported draftPath metadata (one planner
                // reported the concept path instead of its draft).
                kimi: {
                  ...deps.kimi,
                  draftPath: `${PLAN_COUNCIL_DIR}/draft-kimi-k3.md`,
                },
                codex: {
                  ...deps.codex,
                  draftPath: `${PLAN_COUNCIL_DIR}/draft-codex-56-sol-x-high.md`,
                },
                fable: {
                  ...deps.fable,
                  draftPath: `${PLAN_COUNCIL_DIR}/draft-fable.md`,
                },
              })}
              planPathHint={resolvedPlanPath?.planPath ?? ""}
              sequenceHint={resolvedPlanPath?.sequence ?? 0}
            />
          )}
        </Task>

        {concept && synthesis ? (
          <Loop
            id="review-revise-loop"
            maxIterations={3}
            until={loopDone}
            onMaxReached="return-last"
          >
            <Sequence>
              <Task
                id="review-plan"
                output={outputs.review}
                outputSchema={reviewOutputSchema}
                agent={providers.kimiK3Thinking}
                timeoutMs={1_800_000}
                heartbeatTimeoutMs={600_000}
                needs={{ synthesis: "synthesize-plan" }}
                deps={{ synthesis: synthesisOutputSchema }}
              >
                {(deps) => (
                  <PlanCouncilReviewPrompt
                    concept={formatJson(concept)}
                    synthesis={formatJson(deps.synthesis)}
                    planPath={currentPlanPath}
                    iteration={reviewIterations + 1}
                  />
                )}
              </Task>

              <Branch
                if={reviewApproved}
                then={
                  <Task
                    id="keep-approved-plan"
                    output={outputs.loopState}
                    outputSchema={loopStateOutputSchema}
                    needs={{ review: "review-plan" }}
                    deps={{ review: reviewOutputSchema }}
                  >
                    {(deps) => ({
                      planPath: currentPlanPath,
                      summary: deps.review.summary,
                      approved: true,
                      iterations: reviewIterations,
                    })}
                  </Task>
                }
                else={
                  canRevise ? (
                    <Task
                      id="revise-plan"
                      output={outputs.revision}
                      outputSchema={revisionOutputSchema}
                      agent={providers.kimiK3}
                      timeoutMs={1_800_000}
                      heartbeatTimeoutMs={600_000}
                      needs={{ review: "review-plan" }}
                      deps={{ review: reviewOutputSchema }}
                    >
                      {(deps) => (
                        <PlanCouncilRevisePrompt
                          concept={formatJson(concept)}
                          planPath={currentPlanPath}
                          review={formatJson(deps.review)}
                          iteration={reviewIterations}
                        />
                      )}
                    </Task>
                  ) : null
                }
              />
            </Sequence>
          </Loop>
        ) : null}

        {loopFinished ? (
          <Task
            id="finalize-output"
            output={outputs.final}
            outputSchema={finalOutputSchema}
          >
            {async () => ({
              planPath: currentPlanPath,
              summary: finalSummary({
                synthesis,
                review: latestReview,
                revision: latestRevision,
              }),
              approved: latestReview?.approved === true,
              iterations: reviewIterations,
            })}
          </Task>
        ) : null}
      </Sequence>
    </Workflow>
  );
});
