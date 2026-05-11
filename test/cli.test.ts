import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { main, parseArgs, searchInputFromParsedArgs } from "../src/cli.js";

const execFileAsync = promisify(execFile);

describe("CLI argument parsing", () => {
  it("prints help from the help command without running a search", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["help"]);

      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Usage: agent-session-search <query>");
      expect(output).toContain("agent-session-search help");
      expect(output).toContain("agent-session-search --version");
      expect(output).toContain("--json");
      expect(output).toContain("--source <source>");
      expect(output).toContain("--mode <candidates|evidence|debug>");
      expect(output).toContain("--evidence");
      expect(output).toContain("--path <path>");
      expect(output).toContain("--max-results <n>");
      expect(output).toContain("--version");
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

  it("prints the package version without running a search", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["--version"]);
      await main(["-v"]);
      await main(["version"]);

      const version = JSON.parse(readFileSync("package.json", "utf8")).version;
      expect(log.mock.calls).toEqual([[version], [version], [version]]);
    } finally {
      log.mockRestore();
    }
  });

  it("prints machine-readable capabilities without running a search", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["capabilities", "--json"]);

      const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
        tool: string;
        contractVersion: string;
        commands: Array<{ name: string }>;
        mcp: { tools: Array<{ name: string }> };
        exitCodes: Array<{ code: number; meaning: string }>;
      };

      expect(output.tool).toBe("agent-session-search");
      expect(output.contractVersion).toBe("1.0");
      expect(output.commands.map((command) => command.name)).toEqual(
        expect.arrayContaining([
          "search",
          "sources",
          "capabilities",
          "robot-docs guide",
          "--robot-triage",
        ])
      );
      expect(output.mcp.tools).toEqual([{ name: "search_sessions" }]);
      expect(output.exitCodes).toContainEqual({
        code: 1,
        meaning: "user-input-error",
      });
    } finally {
      log.mockRestore();
    }
  });

  it("prints configured source roots without running a search", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-sources-"));
    const root = join(tmp, "sessions");
    const missingRoot = join(tmp, "missing");
    const disabledRoot = join(tmp, "disabled");
    const configPath = join(tmp, "config.json");
    await mkdir(root);
    const canonicalRoot = await realpath(root);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: root, include: ["*.jsonl"] },
          { name: "custom-missing", path: missingRoot, include: ["*.log"] },
          { name: "custom-disabled", path: disabledRoot, enabled: false },
        ],
      })
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["sources", "--json"], {
        ...process.env,
        AGENT_SESSION_SEARCH_CONFIG: configPath,
      });

      const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
        command: string;
        configPath: string;
        sources: Array<{
          name: string;
          root: string;
          include?: string[];
          enabled: boolean;
          status: string;
          warning?: string;
        }>;
        warnings: Array<{ source?: string; code: string; message: string }>;
      };

      expect(output.command).toBe("sources");
      expect(output.configPath).toBe(configPath);
      expect(output.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "codex",
            root: canonicalRoot,
            include: ["*.jsonl"],
            enabled: true,
            status: "ok",
          }),
          expect.objectContaining({
            name: "custom-missing",
            root: missingRoot,
            include: ["*.log"],
            enabled: true,
            status: "missing",
            warning: `Configured root does not exist: ${missingRoot}`,
          }),
          expect.objectContaining({
            name: "custom-disabled",
            root: disabledRoot,
            enabled: false,
            status: "disabled",
          }),
        ])
      );
      expect(output.warnings).toContainEqual({
        source: "custom-missing",
        root: missingRoot,
        code: "missing_root",
        message: `Configured root does not exist: ${missingRoot}`,
      });
    } finally {
      log.mockRestore();
    }
  });

  it("treats --json help as a machine-readable capabilities request", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["--json", "--help"]);

      const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
        tool: string;
        mcp: { tools: Array<{ name: string }> };
      };
      expect(output.tool).toBe("agent-session-search");
      expect(output.mcp.tools).toEqual([{ name: "search_sessions" }]);
    } finally {
      log.mockRestore();
    }
  });

  it("prints robot docs without running a search", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["robot-docs", "guide"]);

      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Agent guide: agent-session-search");
      expect(output).toContain("capabilities --json");
      expect(output).toContain("more.evidence");
      expect(output).toContain("search_sessions");
    } finally {
      log.mockRestore();
    }
  });

  it("prints a robot triage payload without running a search", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["--robot-triage"]);

      const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
        quickRef: unknown;
        recommendedCommands: string[];
        healthChecks: string[];
      };

      expect(output.quickRef).toMatchObject({
        mcpTool: "search_sessions",
        defaultMode: "candidates",
      });
      expect(output.recommendedCommands).toContain(
        'agent-session-search "auth token timeout" --json'
      );
      expect(output.healthChecks).toContain("agent-session-search-doctor");
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
      queries: [],
      operationalContext: {},
      json: true,
      sources: ["codex"],
      resultsDisplayMode: "evidence",
      paths: ["/Users/ben/.codex/sessions/session.jsonl"],
      maxPatterns: undefined,
      maxResultsPerSource: undefined,
      debug: false,
    });
    expect(searchInputFromParsedArgs(args)).toEqual({
      query: "PR 227 papercuts",
      queries: undefined,
      operationalContext: undefined,
      sources: ["codex"],
      resultsDisplayMode: "evidence",
      paths: ["/Users/ben/.codex/sessions/session.jsonl"],
      maxPatterns: undefined,
      maxResultsPerSource: undefined,
      debug: undefined,
    });
  });

  it("maps planned probes and operational context flags to search input", () => {
    const args = parseArgs([
      "Find PR 227 work",
      "--probe",
      "PR #227",
      "--probe",
      "paper-cuts",
      "--cwd",
      "/Users/ben/code/poolside/poolside-studio",
      "--branch",
      "paper-cuts",
      "--reason",
      "Recover prior context",
    ]);

    expect(searchInputFromParsedArgs(args)).toEqual({
      query: "Find PR 227 work",
      queries: ["PR #227", "paper-cuts"],
      operationalContext: {
        cwd: "/Users/ben/code/poolside/poolside-studio",
        branch: "paper-cuts",
        reason: "Recover prior context",
      },
      sources: undefined,
      resultsDisplayMode: undefined,
      paths: undefined,
      maxPatterns: undefined,
      maxResultsPerSource: undefined,
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
      queries: undefined,
      operationalContext: undefined,
      sources: undefined,
      resultsDisplayMode: "debug",
      paths: undefined,
      maxPatterns: undefined,
      maxResultsPerSource: undefined,
      debug: true,
    });
  });

  it("maps explicit caps to search input", () => {
    expect(
      searchInputFromParsedArgs(
        parseArgs([
          "auth token timeout",
          "--max-patterns",
          "3",
          "--max-results",
          "7",
        ])
      )
    ).toEqual({
      query: "auth token timeout",
      queries: undefined,
      operationalContext: undefined,
      sources: undefined,
      resultsDisplayMode: undefined,
      paths: undefined,
      maxPatterns: 3,
      maxResultsPerSource: 7,
      debug: undefined,
    });
  });

  it("rejects unknown options instead of searching for them", () => {
    expect(() => parseArgs(["auth token timeout", "--unknown"])).toThrow(
      "unknown option: --unknown"
    );
    expect(() =>
      parseArgs(["auth token timeout", "--max-results", "0"])
    ).toThrow("--max-results must be a positive integer");
  });

  it("prints a JSON error envelope when --json parse requests fail", async () => {
    const result = await execFileAsync(
      process.execPath,
      [
        join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
        join(process.cwd(), "src", "cli.ts"),
        "--json",
      ],
      { cwd: process.cwd() }
    ).catch((error: unknown) => {
      const execError = error as {
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      expect(execError.code).toBe(1);
      return {
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
      };
    });

    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: "user_input_error",
        message: "query is required",
        suggestedCommand: "agent-session-search help",
      },
    });
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
