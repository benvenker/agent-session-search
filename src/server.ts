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
  const server = createServer(searchOptionsFromEnv());
  await server.start({
    transportType: "stdio",
  });
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
