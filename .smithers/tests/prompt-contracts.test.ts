import { describe, expect, test } from "bun:test";
import { read } from "./helpers";

const schemaBoundPrompts = [
  "prompts/research-probe.mdx",
  "prompts/research-synthesize.mdx",
  "prompts/research.mdx",
  "prompts/plan-context-probe.mdx",
  "prompts/plan-candidate.mdx",
  "prompts/plan-synthesis.mdx",
  "prompts/plan.mdx",
  "prompts/design-critique.mdx",
  "prompts/design-critique-synthesis.mdx",
  "prompts/review-context.mdx",
  "prompts/review.mdx",
  "prompts/review-synthesis.mdx",
  "prompts/implement.mdx",
  "prompts/validate.mdx",
  "prompts/ce-work-implement.mdx",
  "prompts/ce-code-review.mdx",
  "prompts/route-task-classify.mdx",
  "prompts/route-task-execute.mdx",
  "prompts/route-task-recommend.mdx",
  "prompts/create-workflow-clarify.mdx",
  "prompts/create-workflow-design.mdx",
  "prompts/create-workflow-document.mdx",
  "prompts/create-workflow-fix.mdx",
  "prompts/create-workflow-provision.mdx",
  "prompts/create-workflow-scaffold.mdx",
];

describe("schema-bound prompt contracts", () => {
  test("targeted prompts require raw JSON matching the attached schema", () => {
    for (const file of schemaBoundPrompts) {
      const source = read(file);
      expect(source).toContain("{props.schema}");
      expect(source).toContain(
        "Return ONLY raw JSON matching the required output schema."
      );
      expect(source).toContain(
        "Do not include prose, markdown, headings, commentary, or code fences."
      );
      expect(source).toMatch(
        /The first character of your response must be `\{` and the last character must be `\}`\./
      );
    }
  });

  test("research and plan prompts do not ask agents to implement code", () => {
    for (const file of [
      "prompts/research-probe.mdx",
      "prompts/research-synthesize.mdx",
      "prompts/research.mdx",
      "prompts/plan-context-probe.mdx",
      "prompts/plan-candidate.mdx",
      "prompts/plan-synthesis.mdx",
      "prompts/plan.mdx",
    ]) {
      const source = read(file);
      expect(source.toLowerCase()).toContain("do not implement code");
    }
  });
});
