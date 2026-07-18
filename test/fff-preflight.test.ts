import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  checkFffMcp,
  findOrphanFffMcpProcesses,
  handleDoctorEntrypointError,
  main,
  reapOrphanFffMcpProcesses,
  runFffSmokeTest,
  runNativeToolsSmoke,
} from "../src/fff-preflight.js";
import type { FffClient } from "../src/fff-backend.js";
import {
  assessFffMcpVersion,
  assessFffMcpVersionGuidance,
} from "../src/fff-runtime.js";

const execFileAsync = promisify(execFile);

describe("FFF preflight command", () => {
  it("prints help from standard help requests", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["--help"]);
      await main(["-h"]);
      await main(["help"]);

      const outputs = log.mock.calls.map((call) => call.join(" "));
      expect(outputs).toHaveLength(3);
      expect(outputs[0]).toContain("Usage: agent-session-search-doctor");
      expect(outputs[0]).toContain("--json");
      expect(outputs[0]).toContain("--list-orphans");
      expect(outputs[0]).toContain(
        "agent-session-search-doctor --json --skip-smoke"
      );
      expect(outputs[1]).toContain("Usage: agent-session-search-doctor");
      expect(outputs[2]).toContain("Usage: agent-session-search-doctor");
    } finally {
      log.mockRestore();
    }
  });

  it("is exposed and documented as the supported setup check", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8")
    ) as {
      bin: Record<string, string>;
      scripts: Record<string, string>;
    };
    const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
    const mcpDocs = await readFile(
      join(process.cwd(), "docs", "mcp.md"),
      "utf8"
    );
    const configDocs = await readFile(
      join(process.cwd(), "docs", "configuration.md"),
      "utf8"
    );

    expect(packageJson.bin["agent-session-search-doctor"]).toBe(
      "dist/fff-preflight.js"
    );
    expect(packageJson.scripts["check:fff"]).toBe("tsx src/fff-preflight.ts");
    expect(packageJson.scripts.postinstall).toBe(
      "node scripts/postinstall.mjs"
    );
    expect(readme).toContain("npm run check:fff");
    expect(readme).toContain("agent-session-search-doctor");
    expect(readme).toContain("agent-session-search-doctor --json");
    expect(readme).toContain("AGENT_SESSION_SEARCH_CONFIG");
    expect(readme).toContain("[Configuration](docs/configuration.md)");
    expect(mcpDocs).toContain("agent-session-search-doctor --json");
    expect(mcpDocs).toContain('"command":"fff-mcp"');
    expect(mcpDocs).toContain('"sourceDiagnostics":{"configPath":');
    expect(configDocs).toContain("AGENT_SESSION_SEARCH_FFF_DB_DIR");
    expect(configDocs).toContain("AGENT_SESSION_SEARCH_CONFIG");
  });

  it("postinstall only prints install guidance when fff-mcp is missing", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-postinstall-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.5\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const staleResult = await execFileAsync(
      process.execPath,
      [join(process.cwd(), "scripts", "postinstall.mjs")],
      {
        cwd: process.cwd(),
        env: sourceProcessEnv({
          CI: "1",
          PATH: fakeBin,
        }),
      }
    );
    expect(staleResult.stdout).toBe("");
    expect(staleResult.stderr).toBe("");

    const emptyPath = await mkdtemp(
      join(tmpdir(), "agent-session-search-postinstall-missing-")
    );
    await mkdir(join(emptyPath, "bin"));
    const missingResult = await execFileAsync(
      process.execPath,
      [join(process.cwd(), "scripts", "postinstall.mjs")],
      {
        cwd: process.cwd(),
        env: sourceProcessEnv({
          CI: "1",
          PATH: join(emptyPath, "bin"),
        }),
      }
    );
    expect(missingResult.stdout).toBe("");
    expect(missingResult.stderr).toContain("fff-mcp for fast file searching");
    expect(missingResult.stderr).toContain(
      "curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash"
    );
  }, 60_000);

  it("fails with actionable installer guidance when fff-mcp is missing from PATH", async () => {
    const emptyPath = await mkdtemp(
      join(tmpdir(), "agent-session-search-empty-path-")
    );
    await mkdir(join(emptyPath, "bin"));

    const result = await execFileAsync(
      process.execPath,
      preflightSourceArgs(),
      {
        cwd: process.cwd(),
        env: sourceProcessEnv({
          PATH: join(emptyPath, "bin"),
        }),
      }
    ).catch((error: unknown) => {
      const execError = error as {
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      expect(execError.code).toBe(3);
      return {
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
      };
    });

    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain("fff-mcp was not found on PATH");
    expect(output).toContain(
      "https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh"
    );
    expect(output).toContain("Review the installer before running it");
    expect(output).not.toContain("npm install");
  }, 60_000);

  it("succeeds with path and version diagnostics when fff-mcp is available", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-path-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 9.9.9-test\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await execFileAsync(
      process.execPath,
      [...preflightSourceArgs(), "--skip-smoke"],
      {
        cwd: process.cwd(),
        env: sourceProcessEnv({
          PATH: fakeBin,
        }),
      }
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("FFF MCP preflight passed.");
    expect(result.stdout).toContain(`resolved path: ${fakeFffMcp}`);
    expect(result.stdout).toContain("version: fff-mcp 9.9.9-test");
    expect(result.stdout).toContain("required FFF MCP: v0.9.6");
    expect(result.stdout).toContain("recommended stable FFF MCP: v0.9.6");
    expect(result.stdout).toContain("smoke: skipped");
    expect(result.stdout).toContain("multi_grep: skipped");
    expect(result.stdout).toContain("recall equivalence: skipped");
    expect(result.stdout).toContain(
      "upgrade command: curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash"
    );
    expect(result.stdout).toContain(`PATH: ${fakeBin}`);
  }, 60_000);

  it("prints a JSON success envelope when requested", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-json-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 9.9.9-test\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await execFileAsync(
      process.execPath,
      [...preflightSourceArgs(), "--json", "--json", "--skip-smoke"],
      {
        cwd: process.cwd(),
        env: sourceProcessEnv({
          PATH: fakeBin,
        }),
      }
    );

    expect(result.stderr).toBe("");
    const payload = parseJsonObject(result.stdout);
    expect(payload).toMatchObject({
      tool: "agent-session-search-doctor",
      contractVersion: "1.0",
      ok: true,
      command: "fff-mcp",
      resolvedPath: fakeFffMcp,
      version: "fff-mcp 9.9.9-test",
      requiredRelease: "v0.9.6",
      recommendedRelease: "v0.9.6",
      installCommand:
        "curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash",
      sourceDiagnostics: {
        configPath: expect.any(String),
        sources: expect.any(Array),
        warnings: expect.any(Array),
      },
      orphans: null,
    });
    expectDoctorChecks(payload, [
      { id: "command_found", status: "passed" },
      { id: "version_minimum", status: "passed" },
      { id: "smoke_grep", status: "skipped" },
      { id: "multi_grep_available", status: "skipped" },
      { id: "recall_equivalence", status: "skipped" },
    ]);
    expect(result.stdout).not.toContain("FFF MCP preflight passed.");
  }, 60_000);

  it("includes configured source diagnostics and missing root warnings in JSON mode", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-json-sources-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    const configPath = join(fakePath, "config.json");
    const missingRoot = join(fakePath, "missing-root");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 9.9.9-test\\n'\n");
    await chmod(fakeFffMcp, 0o755);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          {
            name: "custom",
            path: missingRoot,
            include: ["*.jsonl"],
          },
        ],
      })
    );

    const result = await execFileAsync(
      process.execPath,
      [...preflightSourceArgs(), "--json", "--skip-smoke"],
      {
        cwd: process.cwd(),
        env: sourceProcessEnv({
          PATH: fakeBin,
          AGENT_SESSION_SEARCH_CONFIG: configPath,
        }),
      }
    );

    expect(result.stderr).toBe("");
    const payload = parseJsonObject(result.stdout);
    expect(payload).toMatchObject({
      ok: true,
      sourceDiagnostics: {
        configPath,
        sources: expect.arrayContaining([
          {
            name: "custom",
            root: missingRoot,
            enabled: true,
            status: "missing",
            include: ["*.jsonl"],
            warning: `Configured root does not exist: ${missingRoot}`,
          },
        ]),
        warnings: expect.arrayContaining([
          {
            source: "custom",
            root: missingRoot,
            code: "missing_root",
            message: `Configured root does not exist: ${missingRoot}`,
            recommendedAction: expect.stringContaining(
              "agent-session-search sources --json"
            ),
          },
        ]),
      },
    });
  }, 60_000);

  it("returns a JSON user-input error before FFF checks for malformed config", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-json-bad-config-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    const configPath = join(fakePath, "config.json");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 9.9.9-test\\n'\n");
    await chmod(fakeFffMcp, 0o755);
    await writeFile(configPath, "{ invalid json");

    const result = await runDoctorExpectFailure(
      ["--json", "--skip-smoke"],
      1,
      sourceProcessEnv({
        PATH: fakeBin,
        AGENT_SESSION_SEARCH_CONFIG: configPath,
      })
    );

    expect(result.stdout).toBe("");
    const payload = parseJsonObject(result.stderr);
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: "user_input_error",
      },
      checks: [],
      sourceDiagnostics: null,
      orphans: null,
      exitCode: 1,
    });
    expectErrorMessageContains(
      payload,
      `Config JSON is invalid at ${configPath}`
    );
  }, 60_000);

  it("returns a JSON tool-environment error for config read failures", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-json-config-read-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    const configPath = join(fakePath, "config-dir");
    await mkdir(fakeBin);
    await mkdir(configPath);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 9.9.9-test\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await runDoctorExpectFailure(
      ["--json", "--skip-smoke"],
      3,
      sourceProcessEnv({
        PATH: fakeBin,
        AGENT_SESSION_SEARCH_CONFIG: configPath,
      })
    );

    expect(result.stdout).toBe("");
    const payload = parseJsonObject(result.stderr);
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: "tool_environment_error",
      },
      checks: [],
      sourceDiagnostics: null,
      orphans: null,
      exitCode: 3,
    });
    expectErrorMessageContains(
      payload,
      `Config could not be read at ${configPath}`
    );
  }, 60_000);

  it("preserves source diagnostics when FFF validation fails", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-json-source-fff-fail-")
    );
    const emptyBin = join(fakePath, "bin");
    const sourceRoot = join(fakePath, "source-root");
    const configPath = join(fakePath, "config.json");
    await mkdir(emptyBin);
    await mkdir(sourceRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          {
            name: "custom",
            path: sourceRoot,
            include: ["*.jsonl"],
          },
        ],
      })
    );

    const result = await runDoctorExpectFailure(
      ["--json"],
      3,
      sourceProcessEnv({
        PATH: emptyBin,
        AGENT_SESSION_SEARCH_CONFIG: configPath,
      })
    );

    expect(result.stdout).toBe("");
    const payload = parseJsonObject(result.stderr);
    expect(payload).toMatchObject({
      ok: false,
      error: { code: "tool_environment_error" },
      sourceDiagnostics: {
        configPath,
        sources: expect.arrayContaining([
          {
            name: "custom",
            root: sourceRoot,
            enabled: true,
            status: "ok",
            include: ["*.jsonl"],
          },
        ]),
      },
      exitCode: 3,
    });
  }, 60_000);

  it("models smoke, multi_grep, and recall success as structured checks", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-checks-success-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.6\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await checkFffMcp({
      command: "fff-mcp",
      env: {
        PATH: fakeBin,
      },
      smoke: async () => ({
        ok: true,
        multiGrep: "supported",
        recallEquivalence: "passed",
      }),
      nativeSmoke: async () => ({
        ok: true,
        tools: ["fff_native_capabilities", "fff_grep"],
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.checks).toMatchObject([
        { id: "command_found", status: "passed" },
        { id: "version_minimum", status: "passed" },
        { id: "smoke_grep", status: "passed" },
        { id: "multi_grep_available", status: "passed" },
        { id: "recall_equivalence", status: "passed" },
        { id: "native_server_tools", status: "passed" },
      ]);
    }
  }, 60_000);

  it("fails doctor when the native server smoke check fails", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-native-fail-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.6\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await checkFffMcp({
      command: "fff-mcp",
      env: { PATH: fakeBin },
      smoke: async () => ({
        ok: true,
        multiGrep: "supported",
        recallEquivalence: "passed",
      }),
      nativeSmoke: async () => ({
        ok: false,
        reason: "native boot failed",
      }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(
        "native MCP server startup/tool-listing check failed"
      );
      expectDoctorChecks({ checks: result.checks }, [
        { id: "command_found", status: "passed" },
        { id: "version_minimum", status: "passed" },
        { id: "smoke_grep", status: "passed" },
        { id: "multi_grep_available", status: "passed" },
        { id: "recall_equivalence", status: "passed" },
        { id: "native_server_tools", status: "failed" },
      ]);
    }
  }, 60_000);

  it("threads a custom fff-mcp command into native smoke when PATH lacks fff-mcp", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-native-command-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "custom-fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.6\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    let nativeCommand: string | undefined;
    const result = await checkFffMcp({
      command: fakeFffMcp,
      env: { PATH: fakePath },
      smoke: async () => ({
        ok: true,
        multiGrep: "supported",
        recallEquivalence: "passed",
      }),
      nativeSmoke: async (input) => {
        nativeCommand = input.command;
        return { ok: true, tools: ["fff_native_capabilities"] };
      },
    });

    expect(result.ok).toBe(true);
    expect(nativeCommand).toBe(fakeFffMcp);
  }, 60_000);

  it("fails native smoke instead of hanging when the native server never handshakes", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-native-no-handshake-")
    );
    const fakeServer = join(fakePath, "server.mjs");
    await writeFile(fakeServer, "setInterval(() => {}, 1000);\n");

    const result = await runNativeToolsSmoke({
      command: "fff-mcp",
      env: { PATH: process.env.PATH ?? "" },
      serverCommand: process.execPath,
      serverArgs: [fakeServer],
      timeoutMs: 50,
    });

    expect(result).toEqual({
      ok: false,
      reason: "native_server_tools_timeout",
    });
  }, 60_000);

  it("does not run the native server smoke check when smoke is skipped", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-native-skip-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.6\\n'\n");
    await chmod(fakeFffMcp, 0o755);
    let nativeSmokeCalled = false;

    const result = await checkFffMcp({
      command: "fff-mcp",
      env: { PATH: fakeBin },
      skipSmoke: true,
      nativeSmoke: async () => {
        nativeSmokeCalled = true;
        return { ok: false, reason: "should not run" };
      },
    });

    expect(result.ok).toBe(true);
    expect(nativeSmokeCalled).toBe(false);
    if (result.ok) {
      expect(result.checks.map((check) => check.id)).not.toContain(
        "native_server_tools"
      );
    }
  }, 60_000);

  it("models missing multi_grep as a warning while sequential fallback is healthy", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-checks-fallback-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.6\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await checkFffMcp({
      command: "fff-mcp",
      env: {
        PATH: fakeBin,
      },
      smoke: async () => ({
        ok: true,
        multiGrep: "fallback",
        recallEquivalence: "failed",
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.multiGrep).toBe("fallback");
      expectDoctorChecks({ checks: result.checks }, [
        { id: "command_found", status: "passed" },
        { id: "version_minimum", status: "passed" },
        { id: "smoke_grep", status: "passed" },
        {
          id: "multi_grep_available",
          status: "warning",
          message:
            "multi_grep is unavailable; sequential fallback remains healthy.",
          recommendedAction:
            "Upgrade FFF MCP when convenient to enable multi_grep acceleration.",
        },
        {
          id: "recall_equivalence",
          status: "warning",
          message:
            "Recall equivalence was not proven because sequential fallback was used.",
        },
      ]);
    }
  }, 60_000);

  it("reports recall divergence when the smoke probe fails recall equivalence", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-checks-recall-diverged-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.6\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await checkFffMcp({
      command: "fff-mcp",
      env: {
        PATH: fakeBin,
      },
      smoke: async () => ({
        ok: true,
        multiGrep: "fallback",
        recallEquivalence: "failed",
        fallbackReason: "multi_grep_recall_probe_failed",
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expectDoctorChecks({ checks: result.checks }, [
        { id: "command_found", status: "passed" },
        { id: "version_minimum", status: "passed" },
        { id: "smoke_grep", status: "passed" },
        {
          id: "multi_grep_available",
          status: "warning",
          message:
            "multi_grep is unavailable; sequential fallback remains healthy.",
          recommendedAction:
            "Upgrade FFF MCP when convenient to enable multi_grep acceleration.",
        },
        {
          id: "recall_equivalence",
          status: "warning",
          message:
            "multi_grep recall diverged from sequential results; multi-pattern searches use sequential fallback.",
        },
      ]);
    }
  }, 60_000);

  it("warns about older-than-recommended FFF without failing when fallback search is usable", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-advisory-version-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.5\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await checkFffMcp({
      command: "fff-mcp",
      env: { PATH: fakeBin },
      smoke: async () => ({
        ok: true,
        multiGrep: "fallback",
        recallEquivalence: "failed",
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.versionGuidance).toBe("older_than_recommended");
      expectDoctorChecks({ checks: result.checks }, [
        { id: "command_found", status: "passed" },
        {
          id: "version_minimum",
          status: "warning",
          message:
            'fff-mcp version output "fff-mcp 0.9.5" is older than recommended stable v0.9.6; capability checks decide whether fallback search is usable.',
          recommendedAction:
            "Upgrade FFF MCP when convenient with: curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash",
        },
        { id: "smoke_grep", status: "passed" },
        { id: "multi_grep_available", status: "warning" },
        { id: "recall_equivalence", status: "warning" },
      ]);
    }
  }, 60_000);

  it("assesses fff-mcp version output and stable guidance", () => {
    expect(assessFffMcpVersion("fff-mcp 0.9.5")).toEqual({
      version: "0.9.5",
      ok: true,
    });
    expect(assessFffMcpVersion("fff-mcp 0.9.6")).toEqual({
      ok: true,
      version: "0.9.6",
    });
    expect(assessFffMcpVersion("fff-mcp 1.0.0")).toEqual({
      ok: true,
      version: "1.0.0",
    });
    expect(assessFffMcpVersion("wrapper 9.9.9")).toEqual({
      ok: false,
      reason:
        "fff-mcp version could not be determined from --version output; recommended stable release is v0.9.6",
    });
    expect(assessFffMcpVersionGuidance("fff-mcp 0.9.5")).toEqual({
      ok: true,
      version: "0.9.5",
      status: "older_than_recommended",
      recommendedAction:
        "Upgrade FFF MCP when convenient with: curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash",
    });
    expect(assessFffMcpVersionGuidance("fff-mcp 0.9.6")).toEqual({
      ok: true,
      version: "0.9.6",
      status: "current",
    });
    expect(assessFffMcpVersionGuidance("wrapper 9.9.9")).toEqual({
      ok: true,
      version: "wrapper 9.9.9",
      status: "unknown",
      recommendedAction:
        "Verify FFF MCP with agent-session-search-doctor --json; upgrade manually if capability checks fail: curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash",
    });
  });

  it("warns without failing when fff-mcp is older than recommended stable", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-stale-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.5\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await execFileAsync(
      process.execPath,
      [...preflightSourceArgs(), "--skip-smoke"],
      {
        cwd: process.cwd(),
        env: sourceProcessEnv({
          PATH: fakeBin,
        }),
      }
    );

    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.stderr).toBe("");
    expect(output).toContain("FFF MCP preflight passed.");
    expect(output).toContain("version guidance: older_than_recommended");
    expect(output).toContain(
      "upgrade command: curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash"
    );
    expect(output).toContain(
      "upgrade path: https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh"
    );
  }, 60_000);

  it("finds only orphan fff-mcp processes from ps output", async () => {
    const orphans = await findOrphanFffMcpProcesses({
      listProcesses: async () => [
        { pid: 101, ppid: 1, command: "fff-mcp --no-update-check /tmp/a" },
        { pid: 102, ppid: 999, command: "fff-mcp --no-update-check /tmp/b" },
        { pid: 103, ppid: 1, command: "node dist/server.js" },
      ],
    });

    expect(orphans).toEqual([
      { pid: 101, ppid: 1, command: "fff-mcp --no-update-check /tmp/a" },
    ]);
  });

  it("reaps only orphan fff-mcp processes on demand", async () => {
    const killed: Array<{ pid: number; signal: NodeJS.Signals }> = [];

    const result = await reapOrphanFffMcpProcesses({
      findOrphans: async () => [
        { pid: 101, ppid: 1, command: "fff-mcp --no-update-check /tmp/a" },
        { pid: 102, ppid: 1, command: "fff-mcp --no-update-check /tmp/b" },
      ],
      killProcess: async (pid, signal) => {
        killed.push({ pid, signal });
      },
    });

    expect(killed).toEqual([
      { pid: 101, signal: "SIGKILL" },
      { pid: 102, signal: "SIGKILL" },
    ]);
    expect(result).toEqual({
      found: [
        { pid: 101, ppid: 1, command: "fff-mcp --no-update-check /tmp/a" },
        { pid: 102, ppid: 1, command: "fff-mcp --no-update-check /tmp/b" },
      ],
      reaped: [101, 102],
      failed: [],
    });
  });

  it("prints orphan cleanup output only when requested", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-path-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 9.9.9-test\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const withoutCleanup = await execFileAsync(
      process.execPath,
      [...preflightSourceArgs(), "--skip-smoke"],
      {
        cwd: process.cwd(),
        env: sourceProcessEnv({
          PATH: fakeBin,
          AGENT_SESSION_SEARCH_DOCTOR_PS_FIXTURE:
            "101 1 fff-mcp --no-update-check /tmp/a\\n",
        }),
      }
    );
    expect(withoutCleanup.stdout).not.toContain("Orphan fff-mcp cleanup");

    const withCleanup = await execFileAsync(
      process.execPath,
      [...preflightSourceArgs(), "--skip-smoke", "--list-orphans"],
      {
        cwd: process.cwd(),
        env: sourceProcessEnv({
          PATH: fakeBin,
          AGENT_SESSION_SEARCH_DOCTOR_PS_FIXTURE:
            "101 1 fff-mcp --no-update-check /tmp/a\\n",
        }),
      }
    );
    expect(withCleanup.stdout).toContain("Orphan fff-mcp cleanup:");
    expect(withCleanup.stdout).toContain("found: 1");
    expect(withCleanup.stdout).toContain("pid 101");
  }, 60_000);

  it("returns JSON orphan diagnostics for explicit list mode", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-json-orphan-list-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 9.9.9-test\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await execFileAsync(
      process.execPath,
      [...preflightSourceArgs(), "--json", "--skip-smoke", "--list-orphans"],
      {
        cwd: process.cwd(),
        env: sourceProcessEnv({
          PATH: fakeBin,
          AGENT_SESSION_SEARCH_DOCTOR_PS_FIXTURE:
            "101 1 fff-mcp --no-update-check /tmp/a\n102 2 fff-mcp --no-update-check /tmp/b\n",
        }),
      }
    );

    expect(result.stderr).toBe("");
    expect(parseJsonObject(result.stdout)).toMatchObject({
      ok: true,
      orphans: {
        mode: "list",
        status: "passed",
        found: [
          { pid: 101, ppid: 1, command: "fff-mcp --no-update-check /tmp/a" },
        ],
      },
    });
  }, 60_000);

  it("returns JSON orphan diagnostics for explicit reap mode", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-json-orphan-reap-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    const sleeper = spawn("sleep", ["30"]);
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 9.9.9-test\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    try {
      const result = await execFileAsync(
        process.execPath,
        [...preflightSourceArgs(), "--json", "--skip-smoke", "--reap-orphans"],
        {
          cwd: process.cwd(),
          env: sourceProcessEnv({
            PATH: fakeBin,
            AGENT_SESSION_SEARCH_DOCTOR_PS_FIXTURE: `${sleeper.pid} 1 fff-mcp --no-update-check /tmp/a\n`,
          }),
        }
      );

      expect(result.stderr).toBe("");
      expect(parseJsonObject(result.stdout)).toMatchObject({
        ok: true,
        orphans: {
          mode: "reap",
          status: "passed",
          found: [
            {
              pid: sleeper.pid,
              ppid: 1,
              command: "fff-mcp --no-update-check /tmp/a",
            },
          ],
          reaped: [sleeper.pid],
          failed: [],
        },
      });
    } finally {
      if (!sleeper.killed) {
        sleeper.kill("SIGKILL");
      }
    }
  }, 60_000);

  it("rejects combined list and reap flags in JSON mode", async () => {
    const result = await runDoctorExpectFailure([
      "--json",
      "--list-orphans",
      "--reap-orphans",
    ]);

    expect(result.stdout).toBe("");
    expect(parseJsonObject(result.stderr)).toMatchObject({
      ok: false,
      error: {
        code: "user_input_error",
        message: "--list-orphans and --reap-orphans cannot be used together",
        hint: "Choose --list-orphans for a read-only diagnostic, or --reap-orphans for explicit process cleanup.",
        suggestedCommand: "agent-session-search-doctor --list-orphans",
      },
      orphans: null,
      exitCode: 1,
    });
  });

  it("attaches explicit JSON orphan diagnostics when FFF validation fails", async () => {
    const emptyPath = await mkdtemp(
      join(tmpdir(), "agent-session-search-json-orphan-missing-fff-")
    );
    await mkdir(join(emptyPath, "bin"));

    const result = await runDoctorExpectFailure(
      ["--json", "--list-orphans"],
      3,
      sourceProcessEnv({
        PATH: join(emptyPath, "bin"),
        AGENT_SESSION_SEARCH_DOCTOR_PS_FIXTURE:
          "101 1 fff-mcp --no-update-check /tmp/a\n",
      })
    );

    expect(result.stdout).toBe("");
    expect(parseJsonObject(result.stderr)).toMatchObject({
      ok: false,
      error: { code: "tool_environment_error" },
      orphans: {
        mode: "list",
        status: "passed",
        found: [
          { pid: 101, ppid: 1, command: "fff-mcp --no-update-check /tmp/a" },
        ],
      },
      exitCode: 3,
    });
  }, 60_000);

  it("reports partial JSON reap failures without hiding the orphan status", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-json-orphan-partial-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    const sleeper = spawn("sleep", ["30"]);
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 9.9.9-test\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    try {
      const result = await runDoctorExpectFailure(
        ["--json", "--skip-smoke", "--reap-orphans"],
        4,
        sourceProcessEnv({
          PATH: fakeBin,
          AGENT_SESSION_SEARCH_DOCTOR_PS_FIXTURE: `${sleeper.pid} 1 fff-mcp --no-update-check /tmp/a\n999999 1 fff-mcp --no-update-check /tmp/b\n`,
        })
      );

      expect(result.stdout).toBe("");
      expect(parseJsonObject(result.stderr)).toMatchObject({
        ok: false,
        error: { code: "upstream_failure" },
        orphans: {
          mode: "reap",
          status: "failed",
          reaped: [sleeper.pid],
          failed: [{ pid: 999999 }],
        },
        exitCode: 4,
      });
    } finally {
      if (!sleeper.killed) {
        sleeper.kill("SIGKILL");
      }
    }
  }, 60_000);

  it("teaches unknown doctor options with usage and a safe next command", async () => {
    const result = await runDoctorExpectFailure(["--wat"]);

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown option: --wat");
    expect(result.stderr).toContain(
      "Run help to inspect supported doctor flags."
    );
    expect(result.stderr).toContain(
      "Suggested command: agent-session-search-doctor help"
    );
    expect(result.stderr).toContain("Usage: agent-session-search-doctor");
  });

  it("returns a JSON user-input envelope for unknown doctor options", async () => {
    const result = await runDoctorExpectFailure(["--json", "--wat"]);

    expect(result.stdout).toBe("");
    const payload = parseJsonObject(result.stderr);
    expect(payload).toMatchObject({
      tool: "agent-session-search-doctor",
      contractVersion: "1.0",
      ok: false,
      error: {
        code: "user_input_error",
        message: "Unknown option: --wat",
        hint: "Run help to inspect supported doctor flags.",
        suggestedCommand: "agent-session-search-doctor help",
      },
      checks: [],
      sourceDiagnostics: null,
      orphans: null,
      exitCode: 1,
    });
    expect(result.stderr).not.toContain("Usage: agent-session-search-doctor");
  });

  it("suggests close doctor flag spellings without running preflight", async () => {
    for (const [mistyped, expected] of [
      ["--list-orphan", "--list-orphans"],
      ["--reap-orphan", "--reap-orphans"],
      ["--skip-smok", "--skip-smoke"],
    ] as const) {
      const result = await runDoctorExpectFailure([mistyped]);

      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        `Unknown option: ${mistyped}; did you mean ${expected}?`
      );
      expect(result.stderr).toContain(
        `Suggested command: agent-session-search-doctor ${expected}`
      );
      expect(result.stderr).toContain("Usage: agent-session-search-doctor");
    }
  });

  it("shows usage when --command is missing a value", async () => {
    const result = await runDoctorExpectFailure(["--command"]);

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--command requires a value");
    expect(result.stderr).toContain(
      "Suggested command: agent-session-search-doctor --command <bin>"
    );
    expect(result.stderr).toContain("Usage: agent-session-search-doctor");
  });

  it("returns JSON suggestions when --command is missing a value", async () => {
    const result = await runDoctorExpectFailure(["--json", "--command"]);

    expect(result.stdout).toBe("");
    expect(parseJsonObject(result.stderr)).toMatchObject({
      ok: false,
      error: {
        code: "user_input_error",
        message: "--command requires a value",
        hint: "Pass the fff-mcp binary after --command.",
        suggestedCommand: "agent-session-search-doctor --command <bin>",
      },
      checks: [],
      sourceDiagnostics: null,
      orphans: null,
      exitCode: 1,
    });
  });

  it("does not consume --json as a missing --command value", async () => {
    const result = await runDoctorExpectFailure(["--command", "--json"]);

    expect(result.stdout).toBe("");
    expect(parseJsonObject(result.stderr)).toMatchObject({
      ok: false,
      error: {
        code: "user_input_error",
        message: "--command requires a value",
        hint: "Pass the fff-mcp binary after --command.",
        suggestedCommand: "agent-session-search-doctor --command <bin>",
      },
      checks: [],
      sourceDiagnostics: null,
      orphans: null,
      exitCode: 1,
    });
  });

  it("requires explicit --yes before ensure can run the installer", async () => {
    const result = await runDoctorExpectFailure(["--ensure-fff"]);

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--ensure-fff requires --yes");
    expect(result.stderr).toContain(
      "Suggested command: agent-session-search-doctor --ensure-fff --yes"
    );
  });

  it("returns JSON suggestions before ensure can run the installer", async () => {
    const result = await runDoctorExpectFailure(["--json", "--ensure-fff"]);

    expect(result.stdout).toBe("");
    expect(parseJsonObject(result.stderr)).toMatchObject({
      ok: false,
      error: {
        code: "user_input_error",
        message: "--ensure-fff requires --yes",
        hint: "Doctor will not install or upgrade fff-mcp unless --yes is present.",
        suggestedCommand: "agent-session-search-doctor --ensure-fff --yes",
      },
      checks: [],
      sourceDiagnostics: null,
      orphans: null,
      exitCode: 1,
    });
  });

  it("keeps JSON upstream-failure output for unexpected thrown errors", () => {
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;

    try {
      handleDoctorEntrypointError(new Error("injected unexpected failure"), [
        "--json",
      ]);

      expect(process.exitCode).toBe(4);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [serialized] = errorSpy.mock.calls[0]!;
      const payload = parseJsonObject(String(serialized));
      expect(payload).toMatchObject({
        ok: false,
        error: {
          code: "upstream_failure",
          message: "injected unexpected failure",
        },
        checks: [],
        sourceDiagnostics: null,
        orphans: null,
        exitCode: 4,
      });
    } finally {
      errorSpy.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it("returns a JSON tool-environment envelope when fff-mcp is missing", async () => {
    const emptyPath = await mkdtemp(
      join(tmpdir(), "agent-session-search-json-empty-path-")
    );
    await mkdir(join(emptyPath, "bin"));

    const result = await runDoctorExpectFailure(
      ["--json"],
      3,
      sourceProcessEnv({
        PATH: join(emptyPath, "bin"),
      })
    );

    expect(result.stdout).toBe("");
    const payload = parseJsonObject(result.stderr);
    expect(payload).toMatchObject({
      tool: "agent-session-search-doctor",
      contractVersion: "1.0",
      ok: false,
      error: {
        code: "tool_environment_error",
        message: "fff-mcp was not found on PATH",
        canEnsureFff: true,
        recommendedAction:
          "Install or upgrade FFF MCP with the official installer.",
        suggestedCommand: "agent-session-search-doctor --ensure-fff --yes",
      },
      requiredRelease: "v0.9.6",
      recommendedRelease: "v0.9.6",
      installCommand:
        "curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash",
      sourceDiagnostics: {
        configPath: expect.any(String),
        sources: expect.any(Array),
        warnings: expect.any(Array),
      },
      orphans: null,
      exitCode: 3,
    });
    expectDoctorChecks(payload, [
      {
        id: "command_found",
        status: "missing",
        recommendedAction:
          "Install or upgrade FFF MCP with the official installer.",
      },
      { id: "version_minimum", status: "skipped" },
      { id: "smoke_grep", status: "skipped" },
      { id: "multi_grep_available", status: "skipped" },
      { id: "recall_equivalence", status: "skipped" },
    ]);
  }, 60_000);

  it("returns structured JSON checks when fff-mcp --version fails", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-json-version-fail-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(
      fakeFffMcp,
      "#!/bin/sh\nprintf 'fff-mcp crashed\\n' >&2\nexit 2\n"
    );
    await chmod(fakeFffMcp, 0o755);

    const result = await runDoctorExpectFailure(
      ["--json"],
      3,
      sourceProcessEnv({
        PATH: fakeBin,
      })
    );

    expect(result.stdout).toBe("");
    const payload = parseJsonObject(result.stderr);
    expect(payload).toMatchObject({
      tool: "agent-session-search-doctor",
      contractVersion: "1.0",
      ok: false,
      error: {
        code: "tool_environment_error",
        canEnsureFff: true,
        recommendedAction:
          "Install or upgrade FFF MCP with the official installer.",
        suggestedCommand: "agent-session-search-doctor --ensure-fff --yes",
      },
      requiredRelease: "v0.9.6",
      recommendedRelease: "v0.9.6",
      installCommand:
        "curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash",
      sourceDiagnostics: {
        configPath: expect.any(String),
        sources: expect.any(Array),
        warnings: expect.any(Array),
      },
      orphans: null,
      exitCode: 3,
    });
    expectErrorMessageContains(payload, "fff-mcp --version failed");
    expectDoctorChecks(payload, [
      { id: "command_found", status: "passed" },
      {
        id: "version_minimum",
        status: "failed",
        recommendedAction:
          "Install or upgrade FFF MCP with the official installer.",
      },
      { id: "smoke_grep", status: "skipped" },
      { id: "multi_grep_available", status: "skipped" },
      { id: "recall_equivalence", status: "skipped" },
    ]);
  }, 60_000);

  it("warns for stale custom command JSON without suggesting automatic upgrade", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-json-custom-stale-")
    );
    const fakeFffMcp = join(fakePath, "custom-fff-mcp");
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.5\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await execFileAsync(
      process.execPath,
      [
        ...preflightSourceArgs(),
        "--json",
        "--skip-smoke",
        "--command",
        fakeFffMcp,
      ],
      {
        cwd: process.cwd(),
        env: sourceProcessEnv(),
      }
    );

    expect(result.stderr).toBe("");
    const payload = parseJsonObject(result.stdout);
    expect(payload).toMatchObject({
      ok: true,
      versionGuidance: "older_than_recommended",
    });
    expectDoctorChecks(payload, [
      { id: "command_found", status: "passed" },
      {
        id: "version_minimum",
        status: "warning",
        recommendedAction: expect.stringContaining(
          "curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash"
        ),
      },
      { id: "smoke_grep", status: "skipped" },
      { id: "multi_grep_available", status: "skipped" },
      { id: "recall_equivalence", status: "skipped" },
    ]);
  }, 60_000);

  it("rejects ensure with a custom command because the installer targets PATH fff-mcp", async () => {
    const result = await runDoctorExpectFailure([
      "--command",
      "/tmp/custom-fff-mcp",
      "--ensure-fff",
      "--yes",
    ]);

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "--ensure-fff only supports the default fff-mcp command"
    );
  });

  it("does not upgrade an older installed fff-mcp during explicit ensure", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-entrypoint-ensure-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.5\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await execFileAsync(
      process.execPath,
      [...preflightSourceArgs(), "--skip-smoke", "--ensure-fff", "--yes"],
      {
        cwd: process.cwd(),
        env: sourceProcessEnv({
          PATH: fakeBin,
        }),
      }
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("FFF MCP preflight passed.");
    expect(result.stdout).toContain("version: fff-mcp 0.9.5");
    expect(result.stdout).toContain("version guidance: older_than_recommended");
  }, 60_000);

  it("does not call the explicit ensure installer for an older usable fff-mcp", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-ensure-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.5\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    let installed = false;
    const result = await checkFffMcp({
      command: "fff-mcp",
      env: {
        PATH: fakeBin,
      },
      skipSmoke: true,
      ensureFff: true,
      yes: true,
      installFffMcp: async () => {
        installed = true;
        await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.6\\n'\n");
      },
    });

    expect(installed).toBe(false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe("fff-mcp 0.9.5");
      expect(result.versionGuidance).toBe("older_than_recommended");
      expect(result.requiredRelease).toBe("v0.9.6");
    }
  }, 60_000);

  it("fails when the live grep smoke test fails", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-smoke-fail-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.6\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await checkFffMcp({
      command: "fff-mcp",
      env: {
        PATH: fakeBin,
      },
      smoke: async () => ({
        ok: false,
        reason: "known token was not found",
      }),
    });

    expect(result).toEqual({
      ok: false,
      command: "fff-mcp",
      reason:
        "fff-mcp was found, but a live grep smoke test failed: known token was not found",
      requiredRelease: "v0.9.6",
      recommendedRelease: "v0.9.6",
      installCommand:
        "curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash",
      installerUrl:
        "https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh",
      path: fakeBin,
      canEnsureFff: false,
      checks: [
        { id: "command_found", status: "passed", message: expect.any(String) },
        {
          id: "version_minimum",
          status: "passed",
          message:
            'fff-mcp version output "fff-mcp 0.9.6" matches current stable guidance v0.9.6.',
        },
        {
          id: "smoke_grep",
          status: "failed",
          message: "Live grep smoke test failed: known token was not found",
          recommendedAction:
            "Inspect FFF MCP runtime behavior and source access; reinstalling is not expected to fix this smoke failure.",
        },
        {
          id: "multi_grep_available",
          status: "skipped",
          message:
            "multi_grep availability was not checked because the smoke grep failed.",
        },
        {
          id: "recall_equivalence",
          status: "skipped",
          message:
            "Recall equivalence was not checked because the smoke grep failed.",
        },
      ],
    });
  }, 60_000);

  it("exposes smoke failure JSON with canEnsureFff false", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-json-smoke-fail-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(
      fakeFffMcp,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then',
        "  printf 'fff-mcp 0.9.6\\n'",
        "  exit 0",
        "fi",
        "printf 'broken smoke\\n' >&2",
        "exit 1",
        "",
      ].join("\n")
    );
    await chmod(fakeFffMcp, 0o755);

    const result = await runDoctorExpectFailure(
      ["--json"],
      3,
      sourceProcessEnv({
        PATH: fakeBin,
      })
    );

    expect(result.stdout).toBe("");
    const payload = parseJsonObject(result.stderr);
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: "tool_environment_error",
        canEnsureFff: false,
      },
    });
    expectDoctorChecks(payload, [
      { id: "command_found", status: "passed" },
      { id: "version_minimum", status: "passed" },
      {
        id: "smoke_grep",
        status: "failed",
        recommendedAction:
          "Inspect FFF MCP runtime behavior and source access; reinstalling is not expected to fix this smoke failure.",
      },
      { id: "multi_grep_available", status: "skipped" },
      { id: "recall_equivalence", status: "skipped" },
    ]);
  }, 60_000);
});

describe("runFffSmokeTest recall probe", () => {
  it("promotes multi_grep when its recall matches sequential grep", async () => {
    const result = await runFffSmokeTest({
      command: "fff-mcp",
      env: {},
      createClient: fakeSmokeClient(),
    });

    expect(result).toEqual({
      ok: true,
      multiGrep: "supported",
      recallEquivalence: "passed",
    });
  });

  it("demotes multi_grep when recall diverges like fff-mcp 0.9.6", async () => {
    const result = await runFffSmokeTest({
      command: "fff-mcp",
      env: {},
      createClient: fakeSmokeClient({ perPatternCap: 5 }),
    });

    expect(result).toEqual({
      ok: true,
      multiGrep: "fallback",
      recallEquivalence: "failed",
      fallbackReason: "multi_grep_recall_probe_failed",
    });
  });
});

function fakeSmokeClient(options: { perPatternCap?: number } = {}) {
  return async (root: string): Promise<FffClient> => {
    const sessionPath = join(root, "session.jsonl");

    const matchingLines = async (patterns: string[]) => {
      const raw = await readFile(sessionPath, "utf8");
      return raw
        .split("\n")
        .map((content, index) => ({ content, line: index + 1 }))
        .filter((entry) =>
          patterns.some((pattern) => entry.content.includes(pattern))
        );
    };

    const payload = (entries: Array<{ content: string; line: number }>) => ({
      content: [
        {
          type: "text",
          text: [
            sessionPath,
            ...entries.map((entry) => ` ${entry.line}: ${entry.content}`),
          ].join("\n"),
        },
      ],
    });

    const cap = (
      entries: Array<{ content: string; line: number }>,
      maxResults: number | undefined
    ) =>
      typeof maxResults === "number" ? entries.slice(0, maxResults) : entries;

    return {
      grep: async (input) => {
        const entries = await matchingLines([input.query]);
        return payload(cap(entries, input.maxResults));
      },
      multiGrep: async (input) => {
        if (options.perPatternCap === undefined) {
          const entries = await matchingLines(input.patterns);
          return payload(cap(entries, input.maxResults));
        }
        // Mimics fff-mcp 0.9.6: multi_grep silently truncates each pattern's
        // hits, so recall diverges from sequential grep at the same cap.
        const picked: Array<{ content: string; line: number }> = [];
        for (const pattern of input.patterns) {
          picked.push(
            ...(await matchingLines([pattern])).slice(0, options.perPatternCap)
          );
        }
        picked.sort((left, right) => left.line - right.line);
        return payload(cap(picked, input.maxResults));
      },
      close: async () => {},
    };
  };
}

function preflightSourceArgs() {
  return [
    "--no-warnings",
    join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
    join(process.cwd(), "src", "fff-preflight.ts"),
  ];
}

function sourceProcessEnv(overrides: NodeJS.ProcessEnv = {}) {
  return {
    ...process.env,
    NODE_NO_WARNINGS: "1",
    ...overrides,
  };
}

function parseJsonObject(output: string) {
  const parsed = JSON.parse(output) as Record<string, unknown>;
  expect(parsed).not.toBeNull();
  expect(typeof parsed).toBe("object");
  return parsed;
}

function expectErrorMessageContains(
  payload: Record<string, unknown>,
  expected: string
) {
  const error = payload.error;
  expect(error).not.toBeNull();
  expect(typeof error).toBe("object");
  if (!error || typeof error !== "object" || !("message" in error)) {
    throw new Error("Expected doctor error payload to include a message");
  }
  expect(typeof error.message).toBe("string");
  expect(error.message).toContain(expected);
}

function expectDoctorChecks(
  payload: Record<string, unknown>,
  expected: Array<{
    id: string;
    status: string;
    message?: string;
    recommendedAction?: string;
  }>
) {
  expect(payload.checks).toBeInstanceOf(Array);
  const checks = payload.checks as Array<Record<string, unknown>>;
  expect(checks).toHaveLength(expected.length);
  checks.forEach((check, index) => {
    const expectedCheck = expected[index]!;
    expect(check).toMatchObject({
      id: expectedCheck.id,
      status: expectedCheck.status,
    });
    expect(typeof check.message).toBe("string");
    expect(check.message).not.toBe("");
    if (expectedCheck.message !== undefined) {
      expect(check.message).toBe(expectedCheck.message);
    }
    if (expectedCheck.recommendedAction !== undefined) {
      expect(check.recommendedAction).toEqual(expectedCheck.recommendedAction);
    }
  });
}

async function runDoctorExpectFailure(
  argv: string[],
  expectedCode = 1,
  env: NodeJS.ProcessEnv = sourceProcessEnv()
) {
  return execFileAsync(process.execPath, [...preflightSourceArgs(), ...argv], {
    cwd: process.cwd(),
    env,
  }).catch((error: unknown) => {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    expect(execError.code).toBe(expectedCode);
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
    };
  });
}
