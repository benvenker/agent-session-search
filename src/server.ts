#!/usr/bin/env node
import { FastMCP } from "fastmcp";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createSessionSearch,
  type CreateSessionSearchOptions,
} from "./search.js";
import type { SessionSearch } from "./types.js";
import { searchOptionsFromEnv } from "./env.js";
import { mcpSearchSessionsDescription } from "./help.js";
import { packageVersion } from "./package-info.js";
import { runSearchSessionsTool, searchSessionsInputSchema } from "./tool.js";
import { killTrackedChildProcesses } from "./child-process-cleanup.js";

export function createServer(
  options: CreateSessionSearchOptions = {},
  search: SessionSearch = createSessionSearch(options)
) {
  const server = new FastMCP({
    name: "agent-session-search",
    version: packageVersion(),
  });

  server.addTool({
    name: "search_sessions",
    description: mcpSearchSessionsDescription(),
    parameters: searchSessionsInputSchema,
    execute: async (input) => {
      const result = await runSearchSessionsTool(search, input);
      return JSON.stringify(result, null, 2);
    },
  });

  return server;
}

export async function main() {
  const search = createSessionSearch(searchOptionsFromEnv());
  installProcessCleanupHandlers(() => search.close?.());
  const server = createServer({}, search);
  await server.start({
    transportType: "stdio",
  });
}

export function installProcessCleanupHandlers(
  cleanup?: () => Promise<void> | void
) {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  let exiting = false;

  const shutdown = async (exitCode: number) => {
    if (exiting) {
      return;
    }
    exiting = true;
    await runCleanup(cleanup);
    killTrackedChildProcesses("SIGKILL");
    process.exit(exitCode);
  };

  for (const signal of signals) {
    process.once(signal, () => {
      void shutdown(signal === "SIGINT" ? 130 : 143);
    });
  }

  process.once("exit", () => {
    void runCleanup(cleanup);
    killTrackedChildProcesses("SIGKILL");
  });

  process.stdin.once("readable", () => {
    // Keep stdin in paused mode for FastMCP, but make Node observe EOF so an
    // MCP client closing its stdio pipe terminates this server promptly.
  });
  process.stdin.once("end", () => {
    void shutdown(0);
  });
  process.stdin.once("close", () => {
    void shutdown(0);
  });
}

async function runCleanup(cleanup: (() => Promise<void> | void) | undefined) {
  if (!cleanup) {
    return;
  }
  await Promise.race([
    Promise.resolve().then(cleanup),
    new Promise((resolve) => setTimeout(resolve, 2_000).unref()),
  ]);
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

function isEntrypoint(moduleUrl: string, argvPath: string | undefined) {
  if (!argvPath) {
    return false;
  }
  return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
}
