#!/usr/bin/env node
import { FastMCP } from "fastmcp";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSessionSearch,
  type CreateSessionSearchOptions,
} from "./search.js";
import { runSearchSessionsTool, searchSessionsInputSchema } from "./tool.js";

export function createServer(options: CreateSessionSearchOptions = {}) {
  const server = new FastMCP({
    name: "agent-session-search",
    version: "0.1.0",
  });
  const search = createSessionSearch(options);

  server.addTool({
    name: "search_sessions",
    description: [
      "Search local coding-agent session history across configured sources.",
      "This is an agentic recall tool: when the user request is conversational or underspecified, infer the operational context from your environment and pass several short literal probes in `queries`.",
      "Keep `query` as the original user request for audit/debug. Use `operationalContext` for useful context such as cwd, repo/project, branch, recent chat, or why the user is searching.",
      "If `queries` is omitted, the tool falls back to deterministic rewriting of `query`.",
    ].join(" "),
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

export function searchOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): CreateSessionSearchOptions {
  return {
    configPath: env.AGENT_SESSION_SEARCH_CONFIG,
    fffMcp: env.AGENT_SESSION_SEARCH_FFF_DB_DIR
      ? {
          args: [
            "--no-update-check",
            "--frecency-db",
            join(env.AGENT_SESSION_SEARCH_FFF_DB_DIR, "frecency.mdb"),
            "--history-db",
            join(env.AGENT_SESSION_SEARCH_FFF_DB_DIR, "history.mdb"),
          ],
        }
      : undefined,
    fffEmptyResultRetryAttempts: numberFromEnv(
      env.AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_ATTEMPTS
    ),
    fffEmptyResultRetryDelayMs: numberFromEnv(
      env.AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_DELAY_MS
    ),
  };
}

function numberFromEnv(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
