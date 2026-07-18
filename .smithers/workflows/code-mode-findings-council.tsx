// smithers-source: seeded
// smithers-display-name: Code Mode Findings Council
/** @jsxImportSource smithers-orchestrator */
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { providers } from "../agents";
import FindingsReviewPrompt from "../prompts/code-mode-findings-review.mdx";
import FindingsSynthesisPrompt from "../prompts/code-mode-findings-synthesis.mdx";

const DEFAULT_FINDINGS_PATH =
  "docs/prototypes/findings/2026-07-18-code-mode-client-side-prototype.md";
const DEFAULT_DIGEST_PATH =
  "docs/investigations/code-mode/2026-07-18-digest-brief.md";
const DEFAULT_REPORT_PATH =
  "docs/investigations/code-mode/2026-07-18-prototype-findings-council.md";

const inputSchema = z.object({
  findingsPath: z.string().optional().default(DEFAULT_FINDINGS_PATH),
  digestPath: z.string().optional().default(DEFAULT_DIGEST_PATH),
  reportPath: z.string().optional().default(DEFAULT_REPORT_PATH),
});

const resolveInputOutputSchema = z.object({
  findingsPath: z.string(),
  digestPath: z.string(),
  reportPath: z.string(),
  repoRoot: z.string(),
  inputsReadable: z.boolean(),
  summary: z.string(),
});

const criterionVerdictSchema = z.object({
  criterion: z.string(),
  verdict: z.string(),
  evidence: z.string(),
});

const reviewOutputSchema = z.object({
  reviewer: z.string(),
  summary: z.string(),
  whatItProved: z.array(z.string()).default([]),
  whatItDidNotProve: z.array(z.string()).default([]),
  criterionVerdicts: z.array(criterionVerdictSchema).default([]),
  methodologyIssues: z.array(z.string()).default([]),
  disagreementsWithFindings: z.array(z.string()).default([]),
  confidence: z.string(),
});

const synthesisOutputSchema = z.object({
  reportPath: z.string(),
  summary: z.string(),
  gateEvidenceStrength: z.string(),
  reviewersUsed: z.array(z.string()).default([]),
});

const finalOutputSchema = z.object({
  reportPath: z.string(),
  summary: z.string(),
  gateEvidenceStrength: z.string(),
});

const { Workflow, Task, Sequence, Parallel, smithers, outputs } =
  createSmithers({
    input: inputSchema,
    resolveInput: resolveInputOutputSchema,
    review: reviewOutputSchema,
    synthesis: synthesisOutputSchema,
    final: finalOutputSchema,
  });

function repoRoot() {
  return process.cwd();
}

function toAbsolute(candidate: string) {
  return path.isAbsolute(candidate)
    ? candidate
    : path.resolve(repoRoot(), candidate);
}

function isReadableFile(absolutePath: string) {
  try {
    accessSync(absolutePath, constants.R_OK);
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default smithers((ctx) => {
  const resolved = ctx.outputMaybe("resolveInput", { nodeId: "resolve-input" });
  const kimiReview = ctx.outputMaybe("review", { nodeId: "review-kimi-k3" });
  const codexXHighReview = ctx.outputMaybe("review", {
    nodeId: "review-codex-56-sol-x-high",
  });
  const fableReview = ctx.outputMaybe("review", { nodeId: "review-fable" });
  const codexHighReview = ctx.outputMaybe("review", {
    nodeId: "review-codex-56-sol-high",
  });
  const synthesis = ctx.outputMaybe("synthesis", {
    nodeId: "synthesize-findings-review",
  });

  return (
    <Workflow name="code-mode-findings-council">
      <Sequence>
        <Task
          id="resolve-input"
          output={outputs.resolveInput}
          outputSchema={resolveInputOutputSchema}
        >
          {async () => {
            const findingsPath = ctx.input.findingsPath ?? DEFAULT_FINDINGS_PATH;
            const digestPath = ctx.input.digestPath ?? DEFAULT_DIGEST_PATH;
            const reportPath = ctx.input.reportPath ?? DEFAULT_REPORT_PATH;
            const inputsReadable =
              isReadableFile(toAbsolute(findingsPath)) &&
              isReadableFile(toAbsolute(digestPath));
            return {
              findingsPath,
              digestPath,
              reportPath,
              repoRoot: repoRoot(),
              inputsReadable,
              summary: inputsReadable
                ? `Reviewing ${findingsPath} against ${digestPath}.`
                : `Missing input: findings=${findingsPath} digest=${digestPath}`,
            };
          }}
        </Task>

        <Parallel id="findings-reviewers" maxConcurrency={4}>
          <Task
            id="review-kimi-k3"
            output={outputs.review}
            outputSchema={reviewOutputSchema}
            agent={providers.kimiK3}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
            needs={{ resolved: "resolve-input" }}
            deps={{ resolved: resolveInputOutputSchema }}
          >
            {(deps) => (
              <FindingsReviewPrompt
                reviewer="kimi-k3"
                resolved={formatJson(deps.resolved)}
                schema={formatJson(z.toJSONSchema(reviewOutputSchema))}
              />
            )}
          </Task>
          <Task
            id="review-codex-56-sol-x-high"
            output={outputs.review}
            outputSchema={reviewOutputSchema}
            agent={providers.codex56SolXHigh}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
            needs={{ resolved: "resolve-input" }}
            deps={{ resolved: resolveInputOutputSchema }}
          >
            {(deps) => (
              <FindingsReviewPrompt
                reviewer="codex-56-sol-x-high"
                resolved={formatJson(deps.resolved)}
                schema={formatJson(z.toJSONSchema(reviewOutputSchema))}
              />
            )}
          </Task>
          <Task
            id="review-fable"
            output={outputs.review}
            outputSchema={reviewOutputSchema}
            agent={providers.fable}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
            needs={{ resolved: "resolve-input" }}
            deps={{ resolved: resolveInputOutputSchema }}
          >
            {(deps) => (
              <FindingsReviewPrompt
                reviewer="fable"
                resolved={formatJson(deps.resolved)}
                schema={formatJson(z.toJSONSchema(reviewOutputSchema))}
              />
            )}
          </Task>
          <Task
            id="review-codex-56-sol-high"
            output={outputs.review}
            outputSchema={reviewOutputSchema}
            agent={providers.codex56SolHigh}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
            needs={{ resolved: "resolve-input" }}
            deps={{ resolved: resolveInputOutputSchema }}
          >
            {(deps) => (
              <FindingsReviewPrompt
                reviewer="codex-56-sol-high"
                resolved={formatJson(deps.resolved)}
                schema={formatJson(z.toJSONSchema(reviewOutputSchema))}
              />
            )}
          </Task>
        </Parallel>

        <Task
          id="synthesize-findings-review"
          output={outputs.synthesis}
          outputSchema={synthesisOutputSchema}
          agent={providers.kimiK3}
          timeoutMs={1_800_000}
          heartbeatTimeoutMs={600_000}
          needs={{
            resolved: "resolve-input",
            kimi: "review-kimi-k3",
            codexXHigh: "review-codex-56-sol-x-high",
            fable: "review-fable",
            codexHigh: "review-codex-56-sol-high",
          }}
          deps={{
            resolved: resolveInputOutputSchema,
            kimi: reviewOutputSchema,
            codexXHigh: reviewOutputSchema,
            fable: reviewOutputSchema,
            codexHigh: reviewOutputSchema,
          }}
        >
          {(deps) => (
            <FindingsSynthesisPrompt
              resolved={formatJson(deps.resolved)}
              reviews={formatJson({
                kimi: deps.kimi,
                codexXHigh: deps.codexXHigh,
                fable: deps.fable,
                codexHigh: deps.codexHigh,
              })}
              schema={formatJson(z.toJSONSchema(synthesisOutputSchema))}
            />
          )}
        </Task>

        {synthesis ? (
          <Task
            id="finalize-output"
            output={outputs.final}
            outputSchema={finalOutputSchema}
          >
            {async () => ({
              reportPath: synthesis.reportPath,
              summary: synthesis.summary,
              gateEvidenceStrength: synthesis.gateEvidenceStrength,
            })}
          </Task>
        ) : null}
      </Sequence>
    </Workflow>
  );
});
