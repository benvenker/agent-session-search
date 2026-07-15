import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("package build and tarball", () => {
  it("ships executable bin entries without local agent files or tests", async () => {
    await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });

    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8")
    ) as {
      bin: Record<string, string>;
    };

    for (const binTarget of Object.values(packageJson.bin)) {
      await access(join(process.cwd(), binTarget));
    }

    const { stderr } = await execFileAsync(
      "node",
      [join(process.cwd(), packageJson.bin["agent-session-search"])],
      {
        cwd: process.cwd(),
      }
    ).catch((error: unknown) => {
      const execError = error as {
        stderr?: string;
        stdout?: string;
        code?: number;
      };
      expect(execError.code).toBe(1);
      return { stderr: execError.stderr ?? "", stdout: execError.stdout ?? "" };
    });
    expect(stderr).toContain("Usage: agent-session-search");

    const installRoot = await mkdtemp(
      join(tmpdir(), "agent-session-search-install-")
    );
    const packDestination = join(installRoot, "packed");
    const appRoot = join(installRoot, "app");
    await mkdir(packDestination);
    await mkdir(appRoot);

    const pack = await execFileAsync(
      "npm",
      ["pack", "--json", "--pack-destination", packDestination],
      { cwd: process.cwd() }
    );
    const tarball = (JSON.parse(pack.stdout) as Array<{ filename: string }>)[0]
      ?.filename;
    expect(tarball).toBeTruthy();

    await execFileAsync("npm", ["init", "-y"], { cwd: appRoot });
    const emptyBin = join(installRoot, "empty-bin");
    await mkdir(emptyBin);
    const install = await execFileAsync(
      "npm",
      [
        "install",
        "--foreground-scripts",
        "--no-audit",
        "--no-fund",
        join(packDestination, tarball),
      ],
      {
        cwd: appRoot,
        env: {
          ...process.env,
          CI: "1",
          PATH: `${emptyBin}${delimiter}${dirname(process.execPath)}${delimiter}/usr/bin${delimiter}/bin`,
        },
      }
    );
    const installedPackageRoot = join(
      appRoot,
      "node_modules",
      "@benvenker",
      "agent-session-search"
    );
    const installedPaths = (
      await readdir(installedPackageRoot, { recursive: true })
    ).map((path) => path.replaceAll("\\", "/"));

    expect(installedPaths).toContain("dist/cli.js");
    expect(installedPaths).toContain("dist/fff-preflight.js");
    expect(installedPaths).toContain("dist/server.js");
    expect(installedPaths).toContain("AGENTS.md");
    expect(installedPaths).toContain("DESIGN.md");
    expect(installedPaths).toContain("scripts/postinstall.mjs");
    expect(installedPaths).not.toContain("dist/test/packaging.test.js");
    for (const forbiddenPrefix of [
      ".agents/",
      ".claude/",
      ".factory/",
      ".goose/",
      ".pi/",
      "skills/",
      "test/",
      "dist/test/",
    ]) {
      expect(
        installedPaths.find((path) => path.startsWith(forbiddenPrefix))
      ).toBeUndefined();
    }
    expect(installedPaths).not.toContain("skills-lock.json");
    expect(
      installedPaths.find((path) => path.startsWith(".beads/.br_history/"))
    ).toBeUndefined();
    const installOutput = `${install.stdout}\n${install.stderr}`;
    expect(installOutput).toContain(
      "agent-session-search uses fff-mcp for fast file searching, but it's not installed."
    );
    expect(installOutput).toContain("Recommended stable FFF MCP: v0.9.5");
    expect(installOutput).toContain(
      "Install FFF with: curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh | bash"
    );
    expect(installOutput).toContain(
      "Then verify with: agent-session-search-doctor"
    );

    const installedCli = join(
      appRoot,
      "node_modules",
      ".bin",
      "agent-session-search"
    );
    const installedDoctor = join(
      appRoot,
      "node_modules",
      ".bin",
      "agent-session-search-doctor"
    );
    const installedServer = join(
      appRoot,
      "node_modules",
      ".bin",
      "agent-session-search-mcp"
    );
    const installedCliResult = await execFileAsync(installedCli, [], {
      cwd: appRoot,
    }).catch((error: unknown) => {
      const execError = error as {
        stderr?: string;
        stdout?: string;
        code?: number;
      };
      expect(execError.code).toBe(1);
      return { stderr: execError.stderr ?? "", stdout: execError.stdout ?? "" };
    });
    expect(
      `${installedCliResult.stdout}\n${installedCliResult.stderr}`
    ).toContain("Usage: agent-session-search");

    const fakeBin = join(installRoot, "fake-bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(
      fakeFffMcp,
      "#!/bin/sh\nprintf 'fff-mcp 9.9.9-package-test\\n'\n"
    );
    await chmod(fakeFffMcp, 0o755);
    const installedDoctorResult = await execFileAsync(
      installedDoctor,
      ["--skip-smoke"],
      {
        cwd: appRoot,
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${dirname(process.execPath)}`,
        },
      }
    );
    expect(installedDoctorResult.stdout).toContain("FFF MCP preflight passed.");
    expect(installedDoctorResult.stdout).toContain(
      "version: fff-mcp 9.9.9-package-test"
    );
    expect(installedDoctorResult.stdout).toContain(
      "recommended stable FFF MCP: v0.9.5"
    );
    expect(installedDoctorResult.stdout).toContain("smoke: skipped");
    expect(installedDoctorResult.stdout).toContain("multi_grep: skipped");

    const transport = new StdioClientTransport({
      command: installedServer,
      args: [],
      cwd: appRoot,
      stderr: "pipe",
    });
    const client = new Client({
      name: "agent-session-search-package-test",
      version: "0.1.0",
    });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("search_sessions");
    } finally {
      await client.close();
    }
  }, 60_000);
});
