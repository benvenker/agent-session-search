import { describe, expect, it } from "vitest";
import { parseCassCompatArgv } from "../src/cass-compat/argv.js";
import {
  completeError,
  completeJsonSuccess,
  completeTextSuccess,
} from "../src/cass-compat/output.js";

describe("parseCassCompatArgv", () => {
  it("parses cm search argv including repeated agents and a dash-leading query after --", () => {
    expect(
      parseCassCompatArgv([
        "search",
        "--limit",
        "10",
        "--days",
        "7",
        "--agent",
        "claude_code",
        "--agent",
        "codex",
        "--workspace",
        "/data/projects/agent-session-search",
        "--fields",
        "title,snippet,source_path",
        "--robot",
        "--",
        "-dash-leading query with spaces",
      ])
    ).toEqual({
      ok: true,
      command: {
        verb: "search",
        query: "-dash-leading query with spaces",
        limit: 10,
        days: 7,
        agents: ["claude_code", "codex"],
        workspace: "/data/projects/agent-session-search",
        fields: ["title", "snippet", "source_path"],
        robot: true,
        json: false,
      },
      warnings: [],
    });
  });

  it("parses timeline durations in cm and documented forms", () => {
    expect(
      parseCassCompatArgv(["timeline", "--since", "7d", "--json"])
    ).toEqual({
      ok: true,
      command: { verb: "timeline", sinceDays: 7, json: true },
      warnings: [],
    });
    expect(parseCassCompatArgv(["timeline", "--since", "14"])).toEqual({
      ok: true,
      command: { verb: "timeline", sinceDays: 14, json: false },
      warnings: [],
    });
  });

  it("rejects a zero timeline duration with one usage envelope and empty stdout", () => {
    expect(parseCassCompatArgv(["timeline", "--since", "0", "--json"])).toEqual(
      {
        ok: false,
        completion: {
          stdout: "",
          stderr:
            '{\n  "error": {\n    "code": 2,\n    "kind": "usage",\n    "message": "Invalid value for --since: expected a positive whole number of days",\n    "hint": "Use ~/.local/bin/cass for full cass functionality. Supported surfaces: --version, health, search, export, timeline, stats.",\n    "retryable": false\n  }\n}\n',
          exitCode: 2,
        },
      }
    );
  });

  it("rejects a negative timeline duration", () => {
    const result = parseCassCompatArgv(["timeline", "--since", "-7"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.completion.exitCode).toBe(2);
      expect(result.completion.stdout).toBe("");
      expect(JSON.parse(result.completion.stderr)).toEqual({
        error: {
          code: 2,
          kind: "usage",
          message:
            "Invalid value for --since: expected a positive whole number of days",
          hint: "Use ~/.local/bin/cass for full cass functionality. Supported surfaces: --version, health, search, export, timeline, stats.",
          retryable: false,
        },
      });
      expect(result.completion.stderr.endsWith("\n")).toBe(true);
    }
  });

  it("rejects a fractional timeline duration", () => {
    const result = parseCassCompatArgv(["timeline", "--since", "1.5d"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.completion).toMatchObject({ stdout: "", exitCode: 2 });
      expect(JSON.parse(result.completion.stderr).error).toMatchObject({
        code: 2,
        kind: "usage",
        message:
          "Invalid value for --since: expected a positive whole number of days",
        retryable: false,
      });
      expect(result.completion.stderr.match(/"error"/g)).toHaveLength(1);
    }
  });

  it("rejects a missing timeline duration", () => {
    const result = parseCassCompatArgv(["timeline", "--since"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.completion.stdout).toBe("");
      expect(result.completion.exitCode).toBe(2);
      expect(JSON.parse(result.completion.stderr)).toHaveProperty(
        "error.kind",
        "usage"
      );
    }
  });

  it("rejects a malformed timeline duration", () => {
    const result = parseCassCompatArgv(["timeline", "--since", "7weeks"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.completion).toMatchObject({ stdout: "", exitCode: 2 });
      expect(JSON.parse(result.completion.stderr).error.kind).toBe("usage");
    }
  });

  it("parses markdown and text exports with space and dash-leading paths", () => {
    expect(
      parseCassCompatArgv([
        "export",
        "--format",
        "markdown",
        "--",
        "/tmp/session history/file.jsonl",
      ])
    ).toEqual({
      ok: true,
      command: {
        verb: "export",
        format: "markdown",
        path: "/tmp/session history/file.jsonl",
      },
      warnings: [],
    });
    expect(
      parseCassCompatArgv([
        "export",
        "--format",
        "text",
        "--",
        "-session.jsonl",
      ])
    ).toEqual({
      ok: true,
      command: { verb: "export", format: "text", path: "-session.jsonl" },
      warnings: [],
    });
  });

  it("rejects an export with a missing path", () => {
    const result = parseCassCompatArgv([
      "export",
      "--format",
      "markdown",
      "--",
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.completion).toMatchObject({ stdout: "", exitCode: 2 });
      expect(JSON.parse(result.completion.stderr).error).toMatchObject({
        kind: "usage",
        message: "Missing export path after --",
      });
    }
  });

  it("rejects an unsupported export format", () => {
    const result = parseCassCompatArgv([
      "export",
      "--format",
      "json",
      "--",
      "/tmp/session.jsonl",
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.completion).toMatchObject({ stdout: "", exitCode: 2 });
      expect(JSON.parse(result.completion.stderr).error).toMatchObject({
        kind: "usage",
        message: "Unsupported export format: json",
      });
    }
  });

  it("rejects an unsupported verb with one usage envelope", () => {
    const result = parseCassCompatArgv(["index", "--robot"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.completion.stdout).toBe("");
      expect(result.completion.exitCode).toBe(2);
      expect(JSON.parse(result.completion.stderr)).toEqual({
        error: {
          code: 2,
          kind: "usage",
          message: "Unsupported cass compatibility verb: index",
          hint: "Use ~/.local/bin/cass for full cass functionality. Supported surfaces: --version, health, search, export, timeline, stats.",
          retryable: false,
        },
      });
    }
  });

  it("parses exactly the version, health, and stats queryless surfaces", () => {
    expect(parseCassCompatArgv(["--version"])).toEqual({
      ok: true,
      command: { verb: "version" },
      warnings: [],
    });
    expect(parseCassCompatArgv(["health", "--json"])).toEqual({
      ok: true,
      command: { verb: "health", json: true },
      warnings: [],
    });
    expect(parseCassCompatArgv(["stats", "--json"])).toEqual({
      ok: true,
      command: { verb: "stats", json: true },
      warnings: [],
    });
  });

  it.each([
    ["missing limit", ["search", "--limit", "--robot", "--", "query"]],
    ["zero limit", ["search", "--limit", "0", "--", "query"]],
    ["negative limit", ["search", "--limit", "-1", "--", "query"]],
    ["fractional limit", ["search", "--limit", "1.5", "--", "query"]],
    ["non-numeric limit", ["search", "--limit", "many", "--", "query"]],
    ["missing days", ["search", "--days", "--", "query"]],
    ["zero days", ["search", "--days", "0", "--", "query"]],
    ["fractional days", ["search", "--days", "2.5", "--", "query"]],
    ["missing agent", ["search", "--agent", "--", "query"]],
    ["missing workspace", ["search", "--workspace", "--", "query"]],
    ["missing fields", ["search", "--fields", "--", "query"]],
    ["missing query", ["search", "--robot", "--"]],
    ["missing since", ["timeline", "--since"]],
    ["malformed since", ["timeline", "--since", "yesterday"]],
    ["missing format", ["export", "--format", "--", "/tmp/a.jsonl"]],
    [
      "unsupported format",
      ["export", "--format", "html", "--", "/tmp/a.jsonl"],
    ],
  ])(
    "rejects malformed known values with one usage envelope and empty stdout: %s",
    (_label, argv) => {
      const result = parseCassCompatArgv(argv);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.completion.stdout).toBe("");
        expect(result.completion.exitCode).toBe(2);
        expect([3, 10]).not.toContain(result.completion.exitCode);
        expect(result.completion.stderr.endsWith("\n")).toBe(true);
        expect(result.completion.stderr.match(/"error"/g)).toHaveLength(1);
        const envelope = JSON.parse(result.completion.stderr);
        expect(envelope.error).toMatchObject({
          code: 2,
          kind: "usage",
          retryable: false,
        });
        expect(envelope.error.hint).toContain("~/.local/bin/cass");
        expect(envelope.error.hint).toContain(
          "--version, health, search, export, timeline, stats"
        );
      }
    }
  );

  it("warns for an unknown flag and continues the known command", () => {
    expect(
      parseCassCompatArgv([
        "search",
        "--future-filter",
        "--limit",
        "3",
        "--robot",
        "--",
        "known query",
      ])
    ).toEqual({
      ok: true,
      command: {
        verb: "search",
        query: "known query",
        limit: 3,
        agents: [],
        robot: true,
        json: false,
      },
      warnings: [
        "Ignoring unknown flag --future-filter for pinned cm 0.2.12 build.",
      ],
    });
  });

  it("builds deterministic stdout-only successes and stderr-only failures", () => {
    expect(completeJsonSuccess({ ok: true })).toEqual({
      stdout: '{\n  "ok": true\n}\n',
      stderr: "",
      exitCode: 0,
    });
    expect(completeTextSuccess("version line\n")).toEqual({
      stdout: "version line\n",
      stderr: "",
      exitCode: 0,
    });
    expect(
      completeError(4, "not-found", "Session missing", "Check the path")
    ).toEqual({
      stdout: "",
      stderr:
        '{\n  "error": {\n    "code": 4,\n    "kind": "not-found",\n    "message": "Session missing",\n    "hint": "Check the path",\n    "retryable": false\n  }\n}\n',
      exitCode: 4,
    });
    expect(completeError(9, "unknown", "Failed", "Retry").exitCode).toBe(9);
  });

  it.each([
    ["version", ["--version", "--future"]],
    ["health", ["health", "--future"]],
    ["timeline", ["timeline", "--since", "7d", "--future"]],
    ["export", ["export", "--format", "text", "--future", "--", "/tmp/a"]],
    ["stats", ["stats", "--future"]],
  ])("warns for unknown flags on the %s surface", (_surface, argv) => {
    const result = parseCassCompatArgv(argv);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([
        "Ignoring unknown flag --future for pinned cm 0.2.12 build.",
      ]);
    }
  });
});
