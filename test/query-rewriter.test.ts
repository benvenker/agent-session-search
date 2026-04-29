import { describe, expect, it } from "vitest";
import { rewriteQueryPatterns } from "../src/query-rewriter.js";

describe("rewriteQueryPatterns", () => {
  it("preserves error fragments, package names, and issue IDs", () => {
    expect(
      rewriteQueryPatterns("Check #42 in @modelcontextprotocol/sdk after TypeError: Cannot read property root", {
        maxPatterns: 4,
      }),
    ).toEqual(["TypeError: Cannot read property root", "@modelcontextprotocol/sdk", "#42"]);
  });
});
