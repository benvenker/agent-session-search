import { describe, expect, it } from "vitest";
import { rewriteQueryPatterns } from "../src/query-rewriter.js";

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
    ]);
  });
});
