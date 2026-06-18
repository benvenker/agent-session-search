import { describe, expect, test } from "bun:test";
import { selectLatestLoopAttempt } from "../ui/loop-attempts";
import { read } from "./helpers";

describe("latest attempt helper", () => {
  test("selects the highest populated attempt over attempt zero", () => {
    const latest = selectLatestLoopAttempt([
      {
        iteration: 0,
        implement: null,
        validate: null,
        review: { approved: false },
      },
      {
        iteration: 1,
        implement: null,
        validate: { allPassed: true },
        review: { approved: true },
      },
      { iteration: 2, implement: null, validate: null, review: null },
    ]);

    expect(latest?.iteration).toBe(1);
    expect(latest?.review).toEqual({ approved: true });
  });

  test("treats reviewer evidence as populated output", () => {
    const latest = selectLatestLoopAttempt([
      { iteration: 0, implement: null, validate: null, review: null },
      {
        iteration: 1,
        implement: null,
        validate: null,
        review: null,
        evidence: [{ approved: true }],
      },
    ]);

    expect(latest?.iteration).toBe(1);
  });
});

describe("loop dashboard contracts", () => {
  const latestAttemptUis = [
    "ui/implement.tsx",
    "ui/research-plan-implement.tsx",
    "ui/improve-test-coverage.tsx",
    "ui/debug.tsx",
  ];

  test("primary loop dashboards use latest-attempt selection", () => {
    for (const file of latestAttemptUis) {
      const source = read(file);
      expect(source).toContain("selectLatestLoopAttempt");
      expect(source).toContain("latestAttempt");
    }
  });

  test("debug preserves manual attempt selection over latest default", () => {
    const source = read("ui/debug.tsx");
    expect(source).toContain(
      "selectedIteration ?? latestAttempt?.iteration ?? 0"
    );
    expect(source).toContain("setSelectedIteration(i)");
  });

  test("kanban stays event-derived and does not introduce attempt-zero verdicts", () => {
    const source = read("ui/kanban.tsx");
    expect(source).not.toContain("review:synthesize");
    expect(source).not.toContain("iteration: 0,\n  });\n  const review");
  });

  test("standalone review UI keeps raw reviewer lanes as evidence only", () => {
    const source = read("ui/review.tsx");

    expect(source).toContain("Approved by review synthesis");
    expect(source).toContain("Blocked by review synthesis");
    expect(source).toContain("Awaiting review synthesis");
    expect(source).not.toContain("Reviewer evidence approved");
    expect(source).not.toMatch(
      /reviews\.length\s*>\s*0\s*&&\s*approvedCount\s*===\s*reviews\.length/
    );
  });
});
