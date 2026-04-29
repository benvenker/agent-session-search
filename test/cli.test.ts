import { describe, expect, it } from "vitest";
import { parseArgs, searchInputFromParsedArgs } from "../src/cli.js";

describe("CLI argument parsing", () => {
  it("maps evidence follow-up flags to search input", () => {
    const args = parseArgs([
      "PR 227 papercuts",
      "--json",
      "--source",
      "codex",
      "--evidence",
      "--path",
      "/Users/ben/.codex/sessions/session.jsonl",
    ]);

    expect(args).toEqual({
      query: "PR 227 papercuts",
      json: true,
      sources: ["codex"],
      resultsDisplayMode: "evidence",
      paths: ["/Users/ben/.codex/sessions/session.jsonl"],
      debug: false,
    });
    expect(searchInputFromParsedArgs(args)).toEqual({
      query: "PR 227 papercuts",
      sources: ["codex"],
      resultsDisplayMode: "evidence",
      paths: ["/Users/ben/.codex/sessions/session.jsonl"],
      debug: undefined,
    });
  });

  it("supports explicit result modes and debug", () => {
    expect(
      searchInputFromParsedArgs(
        parseArgs(["auth token timeout", "--mode", "debug"])
      )
    ).toMatchObject({
      query: "auth token timeout",
      resultsDisplayMode: "debug",
      debug: undefined,
    });

    expect(searchInputFromParsedArgs(parseArgs(["auth", "--debug"]))).toEqual({
      query: "auth",
      sources: undefined,
      resultsDisplayMode: "debug",
      paths: undefined,
      debug: true,
    });
  });

  it("rejects unknown options instead of searching for them", () => {
    expect(() => parseArgs(["auth token timeout", "--unknown"])).toThrow(
      "unknown option: --unknown"
    );
  });
});
