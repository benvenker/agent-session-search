import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("package build and tarball", () => {
  it("keeps postinstall non-destructive for an existing older fff-mcp", async () => {
    const fakeRoot = await mkdtemp(
      join(tmpdir(), "agent-session-search-postinstall-")
    );
    const fakeBin = join(fakeRoot, "bin");
    const fakeFffMcp = join(fakeBin, "fff-mcp");
    await mkdir(fakeBin);
    await writeFile(fakeFffMcp, "#!/bin/sh\nprintf 'fff-mcp 0.9.5\\n'\n");
    await chmod(fakeFffMcp, 0o755);

    const result = await execFileAsync(
      process.execPath,
      [join(process.cwd(), "scripts", "postinstall.mjs")],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CI: "1",
          PATH: fakeBin,
        },
      }
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("ships executable bin entries without local agent files or tests", async () => {
    await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });

    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8")
    ) as {
      bin: Record<string, string>;
    };
    expect(packageJson.bin["agent-session-search-cass-shim"]).toBe(
      "dist/cass-shim.js"
    );

    for (const binTarget of Object.values(packageJson.bin)) {
      await access(join(process.cwd(), binTarget));
    }

    for (const binTarget of Object.values(packageJson.bin)) {
      const stats = await stat(join(process.cwd(), binTarget));
      const isOwnerExecutable = (stats.mode & 0o100) !== 0;
      expect(isOwnerExecutable).toBe(true);
    }

    const cliHelp = await execFileAsync(
      join(process.cwd(), packageJson.bin["agent-session-search"]),
      ["--help"],
      { cwd: process.cwd() }
    );
    expect(`${cliHelp.stdout}\n${cliHelp.stderr}`).toContain(
      "Usage: agent-session-search"
    );

    const doctorHelp = await execFileAsync(
      join(process.cwd(), packageJson.bin["agent-session-search-doctor"]),
      ["--help"],
      { cwd: process.cwd() }
    );
    expect(doctorHelp.stdout).toContain("Usage: agent-session-search-doctor");

    const installRoot = await mkdtemp(
      join(tmpdir(), "agent-session-search-install-")
    );
    const packDestination = join(installRoot, "packed");
    const appRoot = join(installRoot, "app");
    await mkdir(packDestination);
    await mkdir(appRoot);

    await execFileAsync(
      "npm",
      ["pack", "--pack-destination", packDestination],
      { cwd: process.cwd() }
    );
    const tarballs = (await readdir(packDestination)).filter((path) =>
      path.endsWith(".tgz")
    );
    expect(tarballs).toHaveLength(1);
    const tarball = tarballs[0] ?? "";
    const tarManifest = await execFileAsync("tar", [
      "-tzf",
      join(packDestination, tarball),
    ]);
    const packedPaths = tarManifest.stdout.trim().split("\n");
    expect(packedPaths).toContain("package/dist/cass-shim.js");
    expect(packedPaths).toContain("package/dist/cass-compat/run.js");
    expect(packedPaths).toContain("package/docs/cass-shim.md");
    expect(
      packedPaths.find(
        (path) =>
          path.startsWith("package/test/") ||
          path.startsWith("package/test/fixtures/")
      )
    ).toBeUndefined();

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
    expect(installedPaths).toContain("dist/cass-shim.js");
    expect(installedPaths).toContain("dist/cass-compat/run.js");
    expect(installedPaths).toContain("dist/fff-preflight.js");
    expect(installedPaths).toContain("dist/native-server.js");
    expect(installedPaths).toContain("dist/server.js");
    expect(installedPaths).toContain("AGENTS.md");
    expect(installedPaths).toContain("DESIGN.md");
    expect(installedPaths).toContain("scripts/postinstall.mjs");
    expect(installedPaths).toContain("docs/native-mcp.md");
    expect(installedPaths).toContain("docs/cass-shim.md");
    expect(installedPaths).toContain("docs/plans/README.md");
    expect(installedPaths).toContain("docs/maintainers/release.md");
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
    const installedNativeServer = join(
      appRoot,
      "node_modules",
      ".bin",
      "agent-session-search-native-mcp"
    );
    const installedCassShim = join(
      appRoot,
      "node_modules",
      ".bin",
      "agent-session-search-cass-shim"
    );
    const versionStartedAt = performance.now();
    const installedShimVersion = await execFileAsync(
      installedCassShim,
      ["--version"],
      { cwd: appRoot }
    );
    const versionElapsedMs = performance.now() - versionStartedAt;
    expect(versionElapsedMs).toBeLessThan(2_000);
    expect(installedShimVersion.stdout).toMatch(
      /^agent-session-search-cass-shim .+ \(cass-robot-compat for cm\)\n$/
    );
    expect(installedShimVersion.stdout.trim().split("\n")).toHaveLength(1);
    expect(installedShimVersion.stderr).toBe("");

    const bogusShimResult = await execFileAsync(installedCassShim, [
      "bogusverb",
    ]).catch((error: unknown) => {
      const execError = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      expect(execError.code).toBe(2);
      return {
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
      };
    });
    expect(bogusShimResult.stdout).toBe("");
    const bogusEnvelope = JSON.parse(bogusShimResult.stderr);
    expect(bogusEnvelope.error).toMatchObject({
      code: 2,
      kind: "usage",
      hint: expect.stringContaining(
        "--version, health, search, export, timeline, stats"
      ),
    });
    expect(bogusShimResult.stderr.match(/"error"/g)).toHaveLength(1);

    const installedCapabilities = await execFileAsync(
      installedCli,
      ["capabilities", "--json"],
      { cwd: appRoot }
    );
    const capabilities = JSON.parse(installedCapabilities.stdout);
    expect(
      capabilities.mcp.tools.map((tool: { name: string }) => tool.name)
    ).toEqual(["search_sessions"]);
    expect(capabilities.mcp.cassCompatEntrypoint).toEqual({
      command: "agent-session-search-cass-shim",
      optIn: true,
    });
    expect(
      capabilities.mcp.tools.find(
        (tool: { name: string }) =>
          tool.name === "agent-session-search-cass-shim"
      )
    ).toBeUndefined();

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
      "recommended stable FFF MCP: v0.9.6"
    );
    expect(installedDoctorResult.stdout).toContain("version guidance: current");
    expect(installedDoctorResult.stdout).toContain("smoke: skipped");
    expect(installedDoctorResult.stdout).toContain("multi_grep: skipped");
    expect(installedDoctorResult.stdout).toContain(
      "upgrade path: https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh"
    );

    const transport = new StdioClientTransport({
      command: installedServer,
      args: [],
      cwd: appRoot,
      env: stringEnv({
        ...process.env,
        PATH: `${fakeBin}${delimiter}${dirname(process.execPath)}`,
        NODE_NO_WARNINGS: "1",
      }),
      stderr: "pipe",
    });
    const client = new Client({
      name: "agent-session-search-package-test",
      version: "0.1.0",
    });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(["search_sessions"]);
    } finally {
      await client.close();
    }

    const nativeRoot = join(installRoot, "native-root");
    const nativeDb = join(installRoot, "native-db");
    const nativeConfig = join(installRoot, "native-config.json");
    await mkdir(nativeRoot);
    await mkdir(nativeDb);
    await writeFile(join(nativeRoot, "session.jsonl"), "native package hit\n");
    await writeFile(
      nativeConfig,
      JSON.stringify({
        roots: [
          { name: "native_pack", path: nativeRoot, include: ["*.jsonl"] },
        ],
      })
    );

    // Native tool discovery needs a real MCP-speaking fff-mcp (printf fakes
    // cannot complete the upstream handshake). When fff-mcp is unavailable
    // (CI), assert the installed native server fails cleanly pre-handshake
    // instead; discovery coverage lives in test/native-mcp-smoke.test.ts.
    const hasFffMcp = await execFileAsync("fff-mcp", ["--version"]).then(
      () => true,
      () => false
    );

    if (!hasFffMcp) {
      const missingFffResult = await execFileAsync(installedNativeServer, [], {
        cwd: appRoot,
        env: stringEnv({
          PATH: `${emptyBin}${delimiter}${dirname(process.execPath)}`,
          AGENT_SESSION_SEARCH_CONFIG: nativeConfig,
          AGENT_SESSION_SEARCH_FFF_DB_DIR: nativeDb,
          NODE_NO_WARNINGS: "1",
        }),
      }).catch((error: unknown) => {
        const execError = error as {
          code?: number;
          stdout?: string;
          stderr?: string;
        };
        expect(execError.code).toBe(3);
        return {
          stdout: execError.stdout ?? "",
          stderr: execError.stderr ?? "",
        };
      });
      expect(missingFffResult.stderr).toContain(
        "fff-mcp was not found on PATH"
      );
      return;
    }
    const nativeTransport = new StdioClientTransport({
      command: installedNativeServer,
      args: [],
      cwd: appRoot,
      env: stringEnv({
        ...process.env,
        AGENT_SESSION_SEARCH_CONFIG: nativeConfig,
        AGENT_SESSION_SEARCH_FFF_DB_DIR: nativeDb,
        NODE_NO_WARNINGS: "1",
      }),
      stderr: "pipe",
    });
    const nativeClient = new Client({
      name: "agent-session-search-native-package-test",
      version: "0.1.0",
    });

    try {
      await nativeClient.connect(nativeTransport);
      const tools = await nativeClient.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["fff_native_capabilities", "fff_grep"])
      );
    } finally {
      await nativeClient.close();
    }
  }, 60_000);
});

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}
