#!/usr/bin/env node
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createFffMcpClient, OneRootFffBackend } from "./fff-backend.js";
import { doctorHelpText } from "./help.js";
import type { SourceName } from "./types.js";

const execFileAsync = promisify(execFile);

export const FFF_MCP_INSTALLER_URL =
  "https://dmtrkovalenko.dev/install-fff-mcp.sh";

type CheckFffMcpOptions = {
  command?: string;
  env?: NodeJS.ProcessEnv;
  skipSmoke?: boolean;
  smoke?: (input: FffSmokeInput) => Promise<FffSmokeResult>;
  listOrphans?: boolean;
  reapOrphans?: boolean;
};

type CheckFffMcpResult =
  | {
      ok: true;
      command: string;
      resolvedPath?: string;
      version: string;
      path: string;
      smoke: "passed" | "skipped";
    }
  | {
      ok: false;
      command: string;
      reason: string;
      path: string;
    };

type FffSmokeInput = {
  command: string;
};

type FffSmokeResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: string;
    };

export type ProcessInfo = {
  pid: number;
  ppid: number;
  command: string;
};

export type FindOrphanFffMcpProcessesOptions = {
  listProcesses?: () => Promise<ProcessInfo[]>;
};

export type ReapOrphanFffMcpProcessesOptions = {
  findOrphans?: () => Promise<ProcessInfo[]>;
  killProcess?: (pid: number, signal: NodeJS.Signals) => Promise<void> | void;
};

export type ReapOrphanFffMcpProcessesResult = {
  found: ProcessInfo[];
  reaped: number[];
  failed: Array<{ pid: number; message: string }>;
};

export async function checkFffMcp(
  options: CheckFffMcpOptions = {}
): Promise<CheckFffMcpResult> {
  const command = options.command ?? "fff-mcp";
  const env = options.env ?? process.env;
  const path = env.PATH ?? "";

  try {
    const { stdout, stderr } = await execFileAsync(command, ["--version"], {
      env,
    });
    if (!options.skipSmoke) {
      const smoke = await (options.smoke ?? runFffSmokeTest)({ command });
      if (!smoke.ok) {
        return {
          ok: false,
          command,
          reason: `${command} was found, but a live grep smoke test failed: ${smoke.reason}`,
          path,
        };
      }
    }

    return {
      ok: true,
      command,
      resolvedPath: await findOnPath(command, path),
      version: `${stdout}${stderr}`.trim(),
      path,
      smoke: options.skipSmoke ? "skipped" : "passed",
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ok: false,
        command,
        reason: `${command} was not found on PATH`,
        path,
      };
    }
    throw error;
  }
}

export async function findOrphanFffMcpProcesses(
  options: FindOrphanFffMcpProcessesOptions = {}
): Promise<ProcessInfo[]> {
  const processes = await (options.listProcesses ?? listProcesses)();
  return processes.filter(
    (processInfo) =>
      processInfo.ppid === 1 &&
      /(^|[/\s])fff-mcp(\s|$)/.test(processInfo.command)
  );
}

export async function reapOrphanFffMcpProcesses(
  options: ReapOrphanFffMcpProcessesOptions = {}
): Promise<ReapOrphanFffMcpProcessesResult> {
  const found = await (options.findOrphans ?? findOrphanFffMcpProcesses)();
  const killProcess =
    options.killProcess ??
    ((pid: number, signal: NodeJS.Signals) => {
      process.kill(pid, signal);
    });
  const reaped: number[] = [];
  const failed: Array<{ pid: number; message: string }> = [];

  for (const orphan of found) {
    try {
      await killProcess(orphan.pid, "SIGKILL");
      reaped.push(orphan.pid);
    } catch (error) {
      failed.push({
        pid: orphan.pid,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { found, reaped, failed };
}

export async function main(argv = process.argv.slice(2)) {
  if (isHelpRequest(argv)) {
    console.log(doctorHelpText());
    return;
  }

  const options = parseArgs(argv);
  const result = await checkFffMcp(options);

  if (result.ok) {
    console.log("FFF MCP preflight passed.");
    console.log(`command: ${result.command}`);
    if (result.resolvedPath) {
      console.log(`resolved path: ${result.resolvedPath}`);
    }
    console.log(`version: ${result.version || "unknown"}`);
    console.log(
      `smoke: ${result.smoke === "passed" ? "live grep passed" : "skipped"}`
    );
    console.log(`PATH: ${result.path}`);
    if (options.reapOrphans) {
      printReapOrphansResult(await reapOrphanFffMcpProcesses());
    } else if (options.listOrphans) {
      printOrphans(await findOrphanFffMcpProcesses());
    }
    return;
  }

  console.error(result.reason);
  console.error(`PATH: ${result.path}`);
  console.error("");
  console.error("Install FFF MCP with the official installer:");
  console.error(`  curl -L ${FFF_MCP_INSTALLER_URL} | bash`);
  console.error("Review the installer before running it if desired:");
  console.error(`  ${FFF_MCP_INSTALLER_URL}`);
  process.exitCode = 1;
}

function parseArgs(argv: string[]): CheckFffMcpOptions {
  const options: CheckFffMcpOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--command") {
      const command = argv[index + 1];
      if (!command) {
        throw new Error("--command requires a value");
      }
      options.command = command;
      index += 1;
      continue;
    }
    if (arg === "--skip-smoke") {
      options.skipSmoke = true;
      continue;
    }
    if (arg === "--list-orphans") {
      options.listOrphans = true;
      continue;
    }
    if (arg === "--reap-orphans") {
      options.reapOrphans = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function isHelpRequest(argv: string[]) {
  return argv.length === 1 && ["help", "--help", "-h"].includes(argv[0]);
}

async function runFffSmokeTest(input: FffSmokeInput): Promise<FffSmokeResult> {
  const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-fff-smoke-"));
  const root = join(tmp, "root");
  const token = "agent-session-search-doctor-smoke-token";
  let backend: OneRootFffBackend | undefined;

  try {
    await mkdir(root);
    await writeFile(join(root, "session.jsonl"), `before\n${token}\nafter\n`);
    backend = new OneRootFffBackend({
      source: "doctor" as SourceName,
      root,
      client: await createFffMcpClient(root, { command: input.command }),
      timeoutMs: 5_000,
      emptyResultRetryAttempts: 10,
      emptyResultRetryDelayMs: 50,
    });
    const output = await backend.search({ patterns: [token], maxResults: 1 });
    const foundToken = output.results.some((result) =>
      result.content.includes(token)
    );
    if (!foundToken) {
      return {
        ok: false,
        reason: `searched a temporary file for ${token}, but FFF returned ${output.results.length} result(s)`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await backend?.close();
    await rm(tmp, { recursive: true, force: true });
  }
}

function printOrphans(orphans: ProcessInfo[]) {
  console.log("");
  console.log("Orphan fff-mcp cleanup:");
  console.log(`found: ${orphans.length}`);
  for (const orphan of orphans) {
    console.log(`pid ${orphan.pid}: ${orphan.command}`);
  }
}

function printReapOrphansResult(result: ReapOrphanFffMcpProcessesResult) {
  printOrphans(result.found);
  console.log(
    `reaped: ${result.reaped.length ? result.reaped.join(", ") : "none"}`
  );
  if (result.failed.length) {
    console.log(
      `failed: ${result.failed.map((failure) => `${failure.pid} (${failure.message})`).join(", ")}`
    );
  }
}

async function listProcesses(): Promise<ProcessInfo[]> {
  const stdout = process.env.AGENT_SESSION_SEARCH_DOCTOR_PS_FIXTURE;
  const output =
    stdout ??
    (await execFileAsync("ps", ["-axo", "pid=,ppid=,command="])).stdout;
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap(parseProcessLine);
}

function parseProcessLine(line: string): ProcessInfo[] {
  const match = /^(\d+)\s+(\d+)\s+(.+)$/.exec(line);
  if (!match) {
    return [];
  }
  return [
    {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3],
    },
  ];
}

async function findOnPath(command: string, path: string) {
  if (command.includes("/")) {
    return command;
  }

  for (const directory of path.split(delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = join(directory, command);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep scanning PATH entries.
    }
  }
  return undefined;
}

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

function isEntrypoint(moduleUrl: string, argvPath: string | undefined) {
  if (!argvPath) {
    return false;
  }
  return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
}
