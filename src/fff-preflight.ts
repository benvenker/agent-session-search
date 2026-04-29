#!/usr/bin/env node
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createFffMcpClient, OneRootFffBackend } from "./fff-backend.js";
import type { SourceName } from "./types.js";

const execFileAsync = promisify(execFile);

export const FFF_MCP_INSTALLER_URL =
  "https://dmtrkovalenko.dev/install-fff-mcp.sh";

type CheckFffMcpOptions = {
  command?: string;
  env?: NodeJS.ProcessEnv;
  skipSmoke?: boolean;
  smoke?: (input: FffSmokeInput) => Promise<FffSmokeResult>;
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

export async function main(argv = process.argv.slice(2)) {
  const result = await checkFffMcp(parseArgs(argv));

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
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
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
