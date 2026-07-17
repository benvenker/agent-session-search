import { describe, expect, it } from "vitest";
import {
  planQueryPatterns,
  rewriteQueryPatterns,
} from "../src/query-rewriter.js";

describe("rewriteQueryPatterns", () => {
  it("preserves error fragments, package names, and issue IDs", () => {
    expect(
      rewriteQueryPatterns(
        "Check #42 in @modelcontextprotocol/sdk after TypeError: Cannot read property root",
        {
          maxPatterns: 4,
        }
      )
    ).toEqual([
      "TypeError: Cannot read property root",
      "@modelcontextprotocol/sdk",
      "#42",
    ]);
  });

  it("expands natural-language pull request references into searchable variants", () => {
    expect(
      rewriteQueryPatterns(
        "use agent-session-search to find PR 227 and papercuts branch"
      )
    ).toEqual([
      "PR 227",
      "PR #227",
      "pull/227",
      "pull request 227",
      "#227",
      "227",
      "agent-session-search",
      "agent_session_search",
      "agentSessionSearch",
      "papercuts",
      "branch",
    ]);
  });

  it("adds term fallbacks for bare multi-word queries", () => {
    expect(rewriteQueryPatterns("debrand studio")).toEqual([
      "debrand studio",
      "debrand",
      "studio",
    ]);
  });

  it("adds deterministic provenance and match groups for structured plans", () => {
    expect(
      planQueryPatterns("trace `npm run check` near src/search.ts")
    ).toEqual([
      {
        id: "p1",
        query: "trace `npm run check` near src/search.ts",
        pattern: "npm run check",
        provenance: "command",
        initialGroup: "exact_or_structured",
      },
      {
        id: "p2",
        query: "trace `npm run check` near src/search.ts",
        pattern: "src/search.ts",
        provenance: "file_path",
        initialGroup: "exact_or_structured",
      },
      {
        id: "p3",
        query: "trace `npm run check` near src/search.ts",
        pattern: "trace",
        provenance: "natural_term",
        initialGroup: "distinctive_term",
      },
    ]);
  });

  it("assigns stronger provenance to structured fragments than loose configured fallbacks", () => {
    const plans = planQueryPatterns(
      'inspect "retry budget" in packages/core/src/index.ts for @scope/pkg bd-a12 and timeout alias',
      {
        synonyms: {
          alias: ["alternate"],
        },
      }
    );

    expect(
      plans.map((plan) => ({
        pattern: plan.pattern,
        provenance: plan.provenance,
        initialGroup: plan.initialGroup,
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          pattern: "retry budget",
          provenance: "quoted_phrase",
          initialGroup: "exact_or_structured",
        },
        {
          pattern: "@scope/pkg",
          provenance: "package_name",
          initialGroup: "exact_or_structured",
        },
        {
          pattern: "packages/core/src/index.ts",
          provenance: "file_path",
          initialGroup: "exact_or_structured",
        },
        {
          pattern: "bd-a12",
          provenance: "id",
          initialGroup: "exact_or_structured",
        },
        {
          pattern: "alias",
          provenance: "configured_synonym",
          initialGroup: "loose_fallback",
        },
        {
          pattern: "timeout",
          provenance: "natural_term",
          initialGroup: "distinctive_term",
        },
      ])
    );
  });

  it("plans bare recall phrases with exact, adjacent, and term groups", () => {
    expect(
      planQueryPatterns("alpha beta gamma").map((plan) => ({
        pattern: plan.pattern,
        provenance: plan.provenance,
        initialGroup: plan.initialGroup,
      }))
    ).toEqual([
      {
        pattern: "alpha beta gamma",
        provenance: "full_phrase",
        initialGroup: "exact_or_structured",
      },
      {
        pattern: "alpha beta",
        provenance: "adjacent_terms",
        initialGroup: "phrase_or_adjacent_terms",
      },
      {
        pattern: "beta gamma",
        provenance: "adjacent_terms",
        initialGroup: "phrase_or_adjacent_terms",
      },
      {
        pattern: "alpha",
        provenance: "natural_term",
        initialGroup: "distinctive_term",
      },
      {
        pattern: "gamma",
        provenance: "natural_term",
        initialGroup: "distinctive_term",
      },
      {
        pattern: "beta",
        provenance: "natural_term",
        initialGroup: "distinctive_term",
      },
    ]);
  });

  it("uses extractor coverage rather than hard-coded term names for bare phrase groups", () => {
    expect(
      planQueryPatterns("vector lattice comet")
        .filter((plan) => plan.initialGroup !== "distinctive_term")
        .map((plan) => ({
          pattern: plan.pattern,
          provenance: plan.provenance,
          initialGroup: plan.initialGroup,
        }))
    ).toEqual([
      {
        pattern: "vector lattice comet",
        provenance: "full_phrase",
        initialGroup: "exact_or_structured",
      },
      {
        pattern: "vector lattice",
        provenance: "adjacent_terms",
        initialGroup: "phrase_or_adjacent_terms",
      },
      {
        pattern: "lattice comet",
        provenance: "adjacent_terms",
        initialGroup: "phrase_or_adjacent_terms",
      },
    ]);
  });
});
