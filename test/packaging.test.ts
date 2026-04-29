import { access, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("package build and tarball", () => {
  it("ships executable bin entries without local agent files or tests", async () => {
    await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });

    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      bin: Record<string, string>;
    };

    for (const binTarget of Object.values(packageJson.bin)) {
      await access(join(process.cwd(), binTarget));
    }

    const { stderr } = await execFileAsync("node", [join(process.cwd(), packageJson.bin["agent-session-search"])], {
      cwd: process.cwd(),
    }).catch((error: unknown) => {
      const execError = error as { stderr?: string; stdout?: string; code?: number };
      expect(execError.code).toBe(1);
      return { stderr: execError.stderr ?? "", stdout: execError.stdout ?? "" };
    });
    expect(stderr).toContain("Usage: agent-session-search");

    const dryRun = await execFileAsync("npm", ["pack", "--dry-run", "--json"], { cwd: process.cwd() });
    const packed = JSON.parse(dryRun.stdout) as Array<{ files: Array<{ path: string }> }>;
    const packedPaths = packed[0]?.files.map((file) => file.path) ?? [];

    expect(packedPaths).toContain("dist/cli.js");
    expect(packedPaths).toContain("dist/server.js");
    expect(packedPaths).not.toContain("dist/test/packaging.test.js");
    for (const forbiddenPrefix of [".agents/", ".claude/", ".factory/", ".goose/", ".pi/", "skills/", "test/", "dist/test/"]) {
      expect(packedPaths.find((path) => path.startsWith(forbiddenPrefix))).toBeUndefined();
    }
    expect(packedPaths).not.toContain("skills-lock.json");
    expect(packedPaths.find((path) => path.startsWith(".beads/.br_history/"))).toBeUndefined();

    const installRoot = await mkdtemp(join(tmpdir(), "agent-session-search-install-"));
    const packDestination = join(installRoot, "packed");
    const appRoot = join(installRoot, "app");
    await mkdir(packDestination);
    await mkdir(appRoot);

    const pack = await execFileAsync("npm", ["pack", "--json", "--pack-destination", packDestination], { cwd: process.cwd() });
    const tarball = (JSON.parse(pack.stdout) as Array<{ filename: string }>)[0]?.filename;
    expect(tarball).toBeTruthy();

    await execFileAsync("npm", ["init", "-y"], { cwd: appRoot });
    await execFileAsync("npm", ["install", "--no-audit", "--no-fund", join(packDestination, tarball)], { cwd: appRoot });

    const installedCli = join(appRoot, "node_modules", ".bin", "agent-session-search");
    const installedServer = join(appRoot, "node_modules", ".bin", "agent-session-search-mcp");
    const installedCliResult = await execFileAsync(installedCli, [], { cwd: appRoot }).catch((error: unknown) => {
      const execError = error as { stderr?: string; stdout?: string; code?: number };
      expect(execError.code).toBe(1);
      return { stderr: execError.stderr ?? "", stdout: execError.stdout ?? "" };
    });
    expect(`${installedCliResult.stdout}\n${installedCliResult.stderr}`).toContain("Usage: agent-session-search");

    const transport = new StdioClientTransport({
      command: installedServer,
      args: [],
      cwd: appRoot,
      stderr: "pipe",
    });
    const client = new Client({ name: "agent-session-search-package-test", version: "0.1.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("search_sessions");
    } finally {
      await client.close();
    }
  }, 60_000);
});
