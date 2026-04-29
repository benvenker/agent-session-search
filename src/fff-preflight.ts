#!/usr/bin/env node
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const FFF_MCP_INSTALLER_URL = "https://dmtrkovalenko.dev/install-fff-mcp.sh";

type CheckFffMcpOptions = {
  command?: string;
  env?: NodeJS.ProcessEnv;
};

type CheckFffMcpResult =
  | {
      ok: true;
      command: string;
      resolvedPath?: string;
      version: string;
      path: string;
    }
  | {
      ok: false;
      command: string;
      reason: string;
      path: string;
    };

export async function checkFffMcp(options: CheckFffMcpOptions = {}): Promise<CheckFffMcpResult> {
  const command = options.command ?? "fff-mcp";
  const env = options.env ?? process.env;
  const path = env.PATH ?? "";

  try {
    const { stdout, stderr } = await execFileAsync(command, ["--version"], { env });
    return {
      ok: true,
      command,
      resolvedPath: await findOnPath(command, path),
      version: `${stdout}${stderr}`.trim(),
      path,
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

export async function main(argv = process.argv.slice(2)) {
  const result = await checkFffMcp(parseArgs(argv));

  if (result.ok) {
    console.log("FFF MCP preflight passed.");
    console.log(`command: ${result.command}`);
    if (result.resolvedPath) {
      console.log(`resolved path: ${result.resolvedPath}`);
    }
    console.log(`version: ${result.version || "unknown"}`);
    console.log(`PATH: ${result.path}`);
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
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
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
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
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
