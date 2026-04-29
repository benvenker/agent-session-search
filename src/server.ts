import { FastMCP } from "fastmcp";
import { createSessionSearch } from "./search.js";
import { runSearchSessionsTool, searchSessionsInputSchema } from "./tool.js";

export function createServer() {
  const server = new FastMCP({
    name: "agent-session-search",
    version: "0.1.0",
  });
  const search = createSessionSearch();

  server.addTool({
    name: "search_sessions",
    description: "Search local coding-agent session history across configured sources.",
    parameters: searchSessionsInputSchema,
    execute: async (input) => {
      const result = await runSearchSessionsTool(search, input);
      return JSON.stringify(result, null, 2);
    },
  });

  return server;
}

export async function main() {
  const server = createServer();
  await server.start({
    transportType: "stdio",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
