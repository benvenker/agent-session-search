#!/usr/bin/env node
import { FastMCP } from "fastmcp";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createSessionSearch,
  type CreateSessionSearchOptions,
} from "./search.js";
import { searchOptionsFromEnv } from "./env.js";
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
      "Set `query` to a concise recall task, not the full prompt or response-format instructions. Strip tool-use directions, output-format requests, and examples from `query`.",
      "Use `operationalContext` for useful context such as cwd, repo/project, branch, recent chat, why the user is searching, and any relevant prompt details that should not become search text.",
      "If `queries` is omitted, the tool falls back to deterministic rewriting of `query`.",
      "The default `resultsDisplayMode` is `candidates`: compact session-level leads grouped by source/path. Use a candidate `more.evidence` object as the next tool input when you need matching snippets from a selected session. Use `debug` only when inspecting query expansion or backend behavior.",
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
