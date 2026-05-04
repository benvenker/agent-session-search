#!/usr/bin/env node
import { FastMCP } from "fastmcp";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createSessionSearch,
  type CreateSessionSearchOptions,
} from "./search.js";
import { searchOptionsFromEnv } from "./env.js";
import { mcpSearchSessionsDescription } from "./help.js";
import { runSearchSessionsTool, searchSessionsInputSchema } from "./tool.js";
import { killTrackedChildProcesses } from "./child-process-cleanup.js";

export function createServer(options: CreateSessionSearchOptions = {}) {
  const server = new FastMCP({
    name: "agent-session-search",
    version: "0.1.0",
  });
  const search = createSessionSearch(options);

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
  installProcessCleanupHandlers();
  const server = createServer(searchOptionsFromEnv());
  await server.start({
    transportType: "stdio",
  });
}

export function installProcessCleanupHandlers() {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  let exiting = false;

  const shutdown = (exitCode: number) => {
    if (exiting) {
      return;
    }
    exiting = true;
    killTrackedChildProcesses("SIGKILL");
    process.exit(exitCode);
  };

  for (const signal of signals) {
    process.once(signal, () => shutdown(signal === "SIGINT" ? 130 : 143));
  }

  process.once("exit", () => {
    killTrackedChildProcesses("SIGKILL");
  });

  process.stdin.once("readable", () => {
    // Keep stdin in paused mode for FastMCP, but make Node observe EOF so an
    // MCP client closing its stdio pipe terminates this server promptly.
  });
  process.stdin.once("end", () => shutdown(0));
  process.stdin.once("close", () => shutdown(0));
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
