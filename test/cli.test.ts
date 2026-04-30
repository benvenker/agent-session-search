import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main, parseArgs, searchInputFromParsedArgs } from "../src/cli.js";

describe("CLI argument parsing", () => {
  it("prints help from the help command without running a search", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["help"]);

      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Usage: agent-session-search <query>");
      expect(output).toContain("agent-session-search help");
      expect(output).toContain("--json");
      expect(output).toContain("--source <source>");
      expect(output).toContain("--mode <candidates|evidence|debug>");
      expect(output).toContain("--evidence");
      expect(output).toContain("--path <path>");
      expect(output).toContain("agent-session-search-doctor");
      expect(output).toContain("search_sessions");
      expect(output).not.toContain("query: help");
    } finally {
      log.mockRestore();
    }
  });

  it("prints help from standard help flags", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["--help"]);
      await main(["-h"]);

      const outputs = log.mock.calls.map((call) => call.join(" "));
      expect(outputs).toHaveLength(2);
      expect(outputs[0]).toContain("Usage: agent-session-search <query>");
      expect(outputs[1]).toContain("Usage: agent-session-search <query>");
    } finally {
      log.mockRestore();
    }
  });

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

  it("honors environment config when running a search", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-cli-"));
    const missingRoot = join(tmp, "missing-custom-agent");
    const configPath = join(tmp, "config.json");
    await mkdir(tmp, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: join(tmp, "codex"), enabled: false },
          { name: "claude", path: join(tmp, "claude"), enabled: false },
          { name: "pi", path: join(tmp, "pi"), enabled: false },
          { name: "cursor", path: join(tmp, "cursor"), enabled: false },
          { name: "hermes", path: join(tmp, "hermes"), enabled: false },
          { name: "pool", path: join(tmp, "pool"), enabled: false },
          { name: "custom-agent", path: missingRoot, include: ["*.jsonl"] },
        ],
      })
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await main(["auth"], {
        ...process.env,
        AGENT_SESSION_SEARCH_CONFIG: configPath,
      });

      expect(log).toHaveBeenCalledWith("query: auth");
      expect(log).toHaveBeenCalledWith("patterns: auth");
      expect(log).toHaveBeenCalledWith("results: 0");
      expect(warn).toHaveBeenCalledWith(
        `warning: missing_root: Configured root does not exist: ${missingRoot}`
      );
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });
});
