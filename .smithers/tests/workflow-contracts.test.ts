import { describe, expect, test } from "bun:test";
import { buildValidationReviewGate } from "../components/ValidationGate";
import { read } from "./helpers";

describe("validation plus review synthesis gate", () => {
  test("approves only when validation and synthesis approve in the same attempt", () => {
    expect(
      buildValidationReviewGate({
        validate: { allPassed: true, iteration: 1 },
        review: { approved: true, iteration: 1 },
      })
    ).toEqual({ done: true, feedback: null, iteration: 1 });
  });

  test("rejects and returns review feedback when synthesis rejects", () => {
    const result = buildValidationReviewGate({
      validate: { allPassed: true, iteration: 2 },
      review: {
        approved: false,
        feedback: "Needs a stronger assertion.",
        issues: [
          {
            severity: "major",
            title: "Missing test",
            file: "src/example.ts",
            description: "The failure path is untested.",
          },
        ],
        iteration: 2,
      },
    });

    expect(result.done).toBe(false);
    expect(result.feedback).toContain("REVIEW SYNTHESIS REJECTED");
    expect(result.feedback).toContain("[major] Missing test");
  });

  test("combines validation and review feedback in stable order", () => {
    const result = buildValidationReviewGate({
      validate: {
        allPassed: false,
        failingSummary: "npm test failed",
        iteration: 0,
      },
      review: { approved: false, feedback: "Review failed", iteration: 0 },
    });

    expect(result.done).toBe(false);
    expect(result.feedback).toBe(
      "VALIDATION FAILED:\nnpm test failed\n\nREVIEW SYNTHESIS REJECTED:\nReview failed"
    );
  });

  test("does not let stale synthesis approve a newer validation attempt", () => {
    const result = buildValidationReviewGate({
      validate: { allPassed: true, iteration: 1 },
      review: { approved: true, iteration: 0 },
    });

    expect(result).toEqual({ done: false, feedback: null, iteration: 1 });
  });

  test("missing validation cannot complete from any review row", () => {
    expect(
      buildValidationReviewGate({
        review: { approved: true, iteration: 3 },
      })
    ).toEqual({ done: false, feedback: null, iteration: null });
  });
});

describe("workflow source contracts", () => {
  const loopWorkflows = [
    "workflows/implement.tsx",
    "workflows/research-plan-implement.tsx",
    "workflows/debug.tsx",
    "workflows/improve-test-coverage.tsx",
    "workflows/kanban.tsx",
  ];

  test("loop workflows use latest rows and shared gate helper", () => {
    for (const file of loopWorkflows) {
      const source = read(file);
      expect(source).toContain("buildValidationReviewGate");
      expect(source).toContain("ctx.latest");
      expect(source).not.toMatch(/ctx\.outputMaybe\("validate"/);
      expect(source).not.toMatch(/ctx\.outputMaybe\("review"/);
    }
  });

  test("validation loops pass explicit done and feedback", () => {
    for (const file of loopWorkflows) {
      const source = read(file);
      expect(source).toContain("done={");
      expect(source).toContain("feedback={");
    }
  });

  test("CE work review loop invokes CE skills and carries review feedback into retries", () => {
    const workflow = read("workflows/ce-work-review-loop.tsx");
    const implementPrompt = read("prompts/ce-work-implement.mdx");
    const reviewPrompt = read("prompts/ce-code-review.mdx");

    expect(workflow).toContain('<Loop\n        id="ce-work-review-loop:loop"');
    expect(workflow).toContain('ctx.latest("ceReview"');
    expect(workflow).toContain(
      'verdict: z\n    .enum(["Ready to merge", "Ready with fixes", "Not ready"])'
    );
    expect(workflow).toContain(
      "confidence: z.union([z.number(), z.string()]).optional()"
    );
    expect(workflow).toContain("const jsonValueSchema");
    expect(workflow).toContain(
      "triage_groups: z.array(jsonValueSchema).default([])"
    );
    expect(workflow).not.toContain("z.array(z.unknown())");
    expect(workflow).not.toContain("z.record(");
    expect(workflow).toContain(
      'return review.status === "complete" && review.verdict === "Ready to merge";'
    );
    expect(workflow).toContain('previousReviewFeedback={feedback ?? ""}');
    expect(workflow).toContain('onMaxReached="return-last"');
    expect(implementPrompt).toContain(
      "[$ce-work](/home/ben/.agents/skills/ce-work/SKILL.md)"
    );
    expect(implementPrompt).toContain(
      "Do not run `ce-work`'s review, fix-application, commit, PR, or shipping phases"
    );
    expect(reviewPrompt).toContain(
      "[$ce-code-review](/home/ben/.agents/skills/ce-code-review/SKILL.md)"
    );
    expect(reviewPrompt).toContain("mode:agent");
    expect(reviewPrompt).toContain(
      "fresh Smithers agent session for this workflow iteration"
    );
  });

  test("review panel is a strict tuple without fallback backfilling", () => {
    const source = read("components/Review.tsx");
    expect(source).toContain(
      "export type ReviewPanelAgents = [AgentLike, AgentLike, AgentLike]"
    );
    expect(source).toContain("agents: ReviewPanelAgents");
    expect(source).not.toContain("agents: AgentLike[]");
    expect(source).not.toMatch(/\?\?\s*agents/);
    expect(source).not.toMatch(/\?\?\s*synthesisAgent/);
  });

  test("review component fans in context and every required reviewer lane", () => {
    const source = read("components/Review.tsx");
    expect(source).toContain("review0: reviewTaskIds[0]");
    expect(source).toContain("review1: reviewTaskIds[1]");
    expect(source).toContain("review2: reviewTaskIds[2]");
    expect(source).toContain("review0: reviewFindingOutputSchema");
    expect(source).toContain("review1: reviewFindingOutputSchema");
    expect(source).toContain("review2: reviewFindingOutputSchema");
    expect(source).toContain(
      "needs={{ context: contextTaskId, ...reviewNeeds }}"
    );
    expect(source).toContain(
      "deps={{ context: reviewContextOutputSchema, ...reviewDeps }}"
    );
  });

  test("review workflows register supporting review output tables", () => {
    const reviewWorkflows = ["workflows/review.tsx", ...loopWorkflows];

    for (const file of reviewWorkflows) {
      const source = read(file);
      expect(source).toContain("reviewContext: reviewContextOutputSchema");
      expect(source).toContain("reviewFinding: reviewFindingOutputSchema");
      expect(source).toContain("review: reviewOutputSchema");
    }
  });

  test("design critique registers required critic lane output table", () => {
    const source = read("workflows/design-critique.tsx");
    expect(source).toContain(
      "designCritiqueFinding: designCritiqueFindingOutputSchema"
    );
    expect(source).toContain("designCritique: designCritiqueOutputSchema");
  });

  test("planner synthesis fans in every probe and candidate lane", () => {
    const source = read("components/PlannerPanel.tsx");
    expect(source).toContain("seams: `${idPrefix}:context:seams`");
    expect(source).toContain("priorArt: `${idPrefix}:context:prior-art`");
    expect(source).toContain("risks: `${idPrefix}:context:risks`");
    expect(source).toContain("codex: `${idPrefix}:candidate:codex`");
    expect(source).toContain("opus: `${idPrefix}:candidate:opus`");
    expect(source).toContain("seams: planContextOutputSchema");
    expect(source).toContain("priorArt: planContextOutputSchema");
    expect(source).toContain("risks: planContextOutputSchema");
    expect(source).toContain("codex: planCandidateOutputSchema");
    expect(source).toContain("opus: planCandidateOutputSchema");
  });

  test("research synthesis fans in every probe lane", () => {
    const source = read("components/ResearchContext.tsx");
    expect(source).toContain("codebase: `${idPrefix}:codebase`");
    expect(source).toContain("priorArt: `${idPrefix}:prior-art`");
    expect(source).toContain("risksTests: `${idPrefix}:risks-tests`");
    expect(source).toContain("codebase: researchProbeOutputSchema");
    expect(source).toContain("priorArt: researchProbeOutputSchema");
    expect(source).toContain("risksTests: researchProbeOutputSchema");
  });
});
