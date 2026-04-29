import { createSessionSearch } from "./search.js";

function usage() {
  return [
    "Usage: agent-session-search <query> [--json] [--source <source>...]",
    "",
    "Examples:",
    '  agent-session-search "auth token timeout" --json',
    '  agent-session-search "global search" --source codex --source claude',
  ].join("\n");
}

type ParsedArgs = {
  query: string;
  json: boolean;
  sources: string[];
};

function parseArgs(argv: string[]): ParsedArgs {
  const sources: string[] = [];
  const queryParts: string[] = [];
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--source") {
      const source = argv[index + 1];
      if (!source) {
        throw new Error("--source requires a value");
      }
      sources.push(source);
      index += 1;
      continue;
    }
    queryParts.push(arg);
  }

  const query = queryParts.join(" ").trim();
  if (!query) {
    throw new Error("query is required");
  }

  return { query, json, sources };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const search = createSessionSearch();
  const result = await search.searchSessions({
    query: args.query,
    sources: args.sources.length > 0 ? args.sources : undefined,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`query: ${result.query}`);
  console.log(`patterns: ${result.expandedPatterns.join(", ")}`);
  console.log(`results: ${result.results.length}`);
  for (const warning of result.warnings) {
    console.warn(`warning: ${warning.code}: ${warning.message}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage());
    process.exitCode = 1;
  });
}
