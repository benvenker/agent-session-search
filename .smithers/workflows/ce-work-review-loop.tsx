// smithers-source: generated
// smithers-metadata-version: 1
// smithers-display-name: CE Work Review Loop
// smithers-description: Implement with ce-work, then review with ce-code-review mode:agent, carrying review findings into fresh retry sessions.
// smithers-tags: coding, review, compound-engineering
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents } from "../agents";
import CeCodeReviewPrompt from "../prompts/ce-code-review.mdx";
import CeWorkImplementPrompt from "../prompts/ce-work-implement.mdx";

const inputSchema = z.object({
  prompt: z.string().default("Implement the requested change."),
  maxIterations: z.number().int().min(1).max(6).default(3),
});

const ceWorkImplementationOutputSchema = z.object({
  summary: z.string(),
  filesChanged: z.array(z.string()).default([]),
  testsRun: z.array(z.string()).default([]),
  allTestsPassing: z.boolean().default(false),
  remainingWork: z.string().nullable().default(null),
});

const ceReviewIssueSchema = z.object({
  "#": z.union([z.number(), z.string()]).optional(),
  severity: z.string(),
  title: z.string(),
  file: z.string().nullable().optional(),
  line: z.union([z.number(), z.string()]).nullable().optional(),
  confidence: z.union([z.number(), z.string()]).optional(),
  autofix_class: z.string().optional(),
  owner: z.string().optional(),
  requires_verification: z.boolean().optional(),
  pre_existing: z.boolean().optional(),
  suggested_fix: z.string().nullable().optional(),
  why_it_matters: z.string().nullable().optional(),
  evidence: z.union([z.string(), z.array(z.string())]).optional(),
  reviewers: z.array(z.string()).optional(),
  description: z.string().optional(),
});

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.object({}).catchall(jsonValueSchema),
  ])
);

const ceCodeReviewOutputSchema = z
  .object({
    status: z.enum(["complete", "degraded", "failed", "skipped"]),
    verdict: z
      .enum(["Ready to merge", "Ready with fixes", "Not ready"])
      .optional(),
    reason: z.string().optional(),
    scope: z
      .object({
        base: z.string().optional(),
        branch: z.string().optional(),
        head_sha: z.string().optional(),
        pr_url: z.string().nullable().optional(),
        files_changed: z.number().optional(),
      })
      .passthrough()
      .optional(),
    intent: z.string().optional(),
    intent_confidence: z.string().optional(),
    reviewers: z.array(z.string()).default([]),
    findings: z.array(ceReviewIssueSchema.passthrough()).default([]),
    actionable_findings: z.array(ceReviewIssueSchema.passthrough()).default([]),
    triage_groups: z.array(jsonValueSchema).default([]),
    pre_existing_findings: z
      .array(ceReviewIssueSchema.passthrough())
      .default([]),
    requirements_completeness: jsonValueSchema.nullable().default(null),
    learnings: z.array(jsonValueSchema).default([]),
    agent_native_gaps: z.array(jsonValueSchema).default([]),
    deployment_notes: z.array(jsonValueSchema).default([]),
    residual_risks: z.array(jsonValueSchema).default([]),
    testing_gaps: z.array(jsonValueSchema).default([]),
    coverage: z.object({}).catchall(jsonValueSchema).default({}),
    artifact_path: z.string().optional(),
    run_id: z.string().optional(),
  })
  .passthrough();

const { Workflow, Task, Sequence, Loop, smithers, outputs } = createSmithers({
  input: inputSchema,
  ceImplementation: ceWorkImplementationOutputSchema,
  ceReview: ceCodeReviewOutputSchema,
});

function formatImplementation(
  implementation: z.infer<typeof ceWorkImplementationOutputSchema>
) {
  return [
    `Summary: ${implementation.summary}`,
    "Files changed:",
    implementation.filesChanged.length
      ? implementation.filesChanged.map((file) => `- ${file}`).join("\n")
      : "- none reported",
    "Tests run:",
    implementation.testsRun.length
      ? implementation.testsRun.map((command) => `- ${command}`).join("\n")
      : "- none reported",
    `All tests passing: ${implementation.allTestsPassing}`,
    implementation.remainingWork
      ? `Remaining work: ${implementation.remainingWork}`
      : "Remaining work: none reported",
  ].join("\n");
}

function formatReviewFeedback(
  review?: z.infer<typeof ceCodeReviewOutputSchema>
) {
  if (!review || isReviewApproved(review)) {
    return null;
  }

  const parts = [
    `CE-CODE-REVIEW ${review.status.toUpperCase()}`,
    review.verdict ? `Verdict: ${review.verdict}` : null,
    review.reason ? `Reason: ${review.reason}` : null,
    review.intent ? `Intent: ${review.intent}` : null,
  ].filter((part): part is string => Boolean(part));

  const actionableFindings = review.actionable_findings ?? [];
  if (actionableFindings.length > 0) {
    parts.push("Actionable findings:");
    for (const issue of actionableFindings) {
      parts.push(formatReviewIssue(issue));
    }
  }

  const nonActionableFindings = (review.findings ?? []).filter(
    (finding) =>
      !actionableFindings.some((actionable) => sameFinding(finding, actionable))
  );
  if (nonActionableFindings.length > 0) {
    parts.push("Other findings:");
    for (const issue of nonActionableFindings) {
      parts.push(formatReviewIssue(issue));
    }
  }

  if ((review.testing_gaps ?? []).length > 0) {
    parts.push(`Testing gaps:\n${formatUnknownList(review.testing_gaps)}`);
  }
  if ((review.residual_risks ?? []).length > 0) {
    parts.push(`Residual risks:\n${formatUnknownList(review.residual_risks)}`);
  }

  return parts.join("\n");
}

function isReviewApproved(review: z.infer<typeof ceCodeReviewOutputSchema>) {
  return review.status === "complete" && review.verdict === "Ready to merge";
}

function formatReviewIssue(issue: z.infer<typeof ceReviewIssueSchema>) {
  const stableNumber = issue["#"] === undefined ? "" : `#${issue["#"]} `;
  const file = issue.file
    ? ` (${issue.file}${issue.line ? `:${issue.line}` : ""})`
    : "";
  const route =
    issue.autofix_class || issue.owner
      ? ` [${[issue.autofix_class, issue.owner].filter(Boolean).join(" -> ")}]`
      : "";
  const detail =
    issue.suggested_fix ??
    issue.description ??
    issue.why_it_matters ??
    "No additional detail provided.";
  return `- ${stableNumber}[${issue.severity}] ${issue.title}${file}${route}: ${detail}`;
}

function sameFinding(
  left: z.infer<typeof ceReviewIssueSchema>,
  right: z.infer<typeof ceReviewIssueSchema>
) {
  if (left["#"] !== undefined && right["#"] !== undefined) {
    return String(left["#"]) === String(right["#"]);
  }
  return (
    left.title === right.title &&
    left.severity === right.severity &&
    left.file === right.file &&
    left.line === right.line
  );
}

function formatUnknownList(items: unknown[]) {
  return items
    .map((item) => {
      if (typeof item === "string") {
        return `- ${item}`;
      }
      return `- ${JSON.stringify(item)}`;
    })
    .join("\n");
}

export default smithers((ctx) => {
  const review = ctx.latest("ceReview", "ce-work-review-loop:review");
  const feedback = formatReviewFeedback(review);
  const done = review ? isReviewApproved(review) : false;

  return (
    <Workflow name="ce-work-review-loop">
      <Loop
        id="ce-work-review-loop:loop"
        until={done}
        maxIterations={ctx.input.maxIterations}
        onMaxReached="return-last"
      >
        <Sequence>
          <Task
            id="ce-work-review-loop:implement"
            output={outputs.ceImplementation}
            outputSchema={ceWorkImplementationOutputSchema}
            agent={agents.engineer}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
          >
            <CeWorkImplementPrompt
              prompt={ctx.input.prompt}
              previousReviewFeedback={feedback ?? ""}
            />
          </Task>
          <Task
            id="ce-work-review-loop:review"
            output={outputs.ceReview}
            outputSchema={ceCodeReviewOutputSchema}
            agent={agents.reviewSynthesis}
            needs={{ implementation: "ce-work-review-loop:implement" }}
            deps={{ implementation: ceWorkImplementationOutputSchema }}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
          >
            {(deps) => (
              <CeCodeReviewPrompt
                prompt={ctx.input.prompt}
                implementation={formatImplementation(deps.implementation)}
                previousReviewFeedback={feedback ?? ""}
              />
            )}
          </Task>
        </Sequence>
      </Loop>
    </Workflow>
  );
});
