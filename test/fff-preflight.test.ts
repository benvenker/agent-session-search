import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("FFF preflight command", () => {
  it("is exposed and documented as the supported setup check", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      bin: Record<string, string>;
      scripts: Record<string, string>;
    };
    const readme = await readFile(join(process.cwd(), "README.md"), "utf8");

    expect(packageJson.bin["agent-session-search-doctor"]).toBe("./dist/fff-preflight.js");
    expect(packageJson.scripts["check:fff"]).toBe("tsx src/fff-preflight.ts");
    expect(packageJson.scripts.postinstall).toBe("node scripts/postinstall.mjs");
    expect(readme).toContain("npm run check:fff");
    expect(readme).toContain("agent-session-search-doctor");
    expect(readme).toContain("AGENT_SESSION_SEARCH_FFF_DB_DIR");
    expect(readme).toContain("AGENT_SESSION_SEARCH_CONFIG");
  });

  it("fails with actionable installer guidance when fff-mcp is missing from PATH", async () => {
    const emptyPath = await mkdtemp(join(tmpdir(), "agent-session-search-empty-path-"));
    await mkdir(join(emptyPath, "bin"));

    const result = await execFileAsync(process.execPath, preflightSourceArgs(), {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: join(emptyPath, "bin"),
      },
    }).catch((error: unknown) => {
      const execError = error as { stdout?: string; stderr?: string; code?: number };
      expect(execError.code).toBe(1);
      return {
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
      };
    });

    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain("fff-mcp was not found on PATH");
    expect(output).toContain("https://dmtrkovalenko.dev/install-fff-mcp.sh");
    expect(output).toContain("Review the installer before running it");
    expect(output).not.toContain("npm install");
  }, 60_000);

  it("succeeds with path and version diagnostics when fff-mcp is available", async () => {
    const fakePath = await mkdtemp(join(tmpdir(), "agent-session-search-fff-path-"));
    const fakeBin = join(fakePath, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 9.9.9-test\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await execFileAsync(process.execPath, preflightSourceArgs(), {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: fakeBin,
      },
    });

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("FFF MCP preflight passed.");
    expect(result.stdout).toContain(`resolved path: ${fakeFffMcp}`);
    expect(result.stdout).toContain("version: fff-mcp 9.9.9-test");
    expect(result.stdout).toContain(`PATH: ${fakeBin}`);
  }, 60_000);
});

function preflightSourceArgs() {
  return [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), join(process.cwd(), "src", "fff-preflight.ts")];
}
