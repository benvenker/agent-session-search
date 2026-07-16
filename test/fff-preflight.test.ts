import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  checkFffMcp,
  findOrphanFffMcpProcesses,
  main,
  reapOrphanFffMcpProcesses,
} from "../src/fff-preflight.js";
import { assessFffMcpVersion } from "../src/fff-runtime.js";

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
      expect(outputs[0]).toContain("--list-orphans");
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
    expect(readme).toContain("AGENT_SESSION_SEARCH_CONFIG");
    expect(readme).toContain("[Configuration](docs/configuration.md)");
    expect(configDocs).toContain("AGENT_SESSION_SEARCH_FFF_DB_DIR");
    expect(configDocs).toContain("AGENT_SESSION_SEARCH_CONFIG");
  });

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

  it("assesses fff-mcp version output against the required minimum", () => {
    expect(assessFffMcpVersion("fff-mcp 0.9.5")).toEqual({
      ok: false,
      version: "0.9.5",
      reason: "fff-mcp 0.9.5 is below required minimum v0.9.6",
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
        "fff-mcp version could not be determined from --version output; required minimum is v0.9.6",
    });
  });

  it("fails clearly when fff-mcp is below the required minimum", async () => {
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
    expect(output).toContain("fff-mcp 0.9.5 is below required minimum v0.9.6");
    expect(output).toContain(
      "Install or upgrade FFF MCP with the official installer"
    );
    expect(output).toContain("agent-session-search-doctor --ensure-fff --yes");
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

  it("requires explicit --yes before ensure can run the installer", async () => {
    const result = await runDoctorExpectFailure(["--ensure-fff"]);

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--ensure-fff requires --yes");
    expect(result.stderr).toContain(
      "Suggested command: agent-session-search-doctor --ensure-fff --yes"
    );
  });

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

  it("runs the explicit ensure installer path through the doctor entrypoint", async () => {
    const fakePath = await mkdtemp(
      join(tmpdir(), "agent-session-search-fff-entrypoint-ensure-")
    );
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    const fakeBash = join(fakeBin, "bash");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.5\\n'\n");
    await chmod(fakeFffMcp, 0o755);
    await writeFile(
      fakeBash,
      [
        "#!/bin/sh",
        `{ printf '#!/bin/sh\\n'; printf \"printf 'fff-mcp 0.9.6\\\\n'\\n\"; } > ${JSON.stringify(fakeFffMcp)}`,
        "",
      ].join("\n")
    );
    await chmod(fakeBash, 0o755);

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
    expect(result.stdout).toContain("version: fff-mcp 0.9.6");
  }, 60_000);

  it("runs the explicit ensure installer path and rechecks fff-mcp", async () => {
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

    expect(installed).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe("fff-mcp 0.9.6");
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
      path: fakeBin,
      canEnsureFff: false,
    });
  }, 60_000);
});

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

async function runDoctorExpectFailure(argv: string[]) {
  return execFileAsync(process.execPath, [...preflightSourceArgs(), ...argv], {
    cwd: process.cwd(),
    env: sourceProcessEnv(),
  }).catch((error: unknown) => {
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
}
