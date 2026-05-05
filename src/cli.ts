#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { searchOptionsFromEnv } from "./env.js";
import { cliHelpText } from "./help.js";
import { createSessionSearch } from "./search.js";
import type { ResultsDisplayMode, SearchSessionsInput } from "./types.js";

function usage() {
  return cliHelpText();
}

type ParsedArgs = {
  query: string;
  json: boolean;
  sources: string[];
  resultsDisplayMode?: ResultsDisplayMode;
  paths: string[];
  maxPatterns?: number;
  maxResultsPerSource?: number;
  debug: boolean;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const sources: string[] = [];
  const paths: string[] = [];
  const queryParts: string[] = [];
  let json = false;
  let resultsDisplayMode: ResultsDisplayMode | undefined;
  let maxPatterns: number | undefined;
  let maxResultsPerSource: number | undefined;
  let debug = false;

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
    if (arg === "--mode" || arg === "--results-display-mode") {
      resultsDisplayMode = parseResultsDisplayMode(argv[index + 1], arg);
      index += 1;
      continue;
    }
    if (arg === "--candidates") {
      resultsDisplayMode = "candidates";
      continue;
    }
    if (arg === "--evidence") {
      resultsDisplayMode = "evidence";
      continue;
    }
    if (arg === "--debug") {
      debug = true;
      resultsDisplayMode = "debug";
      continue;
    }
    if (arg === "--path") {
      const path = argv[index + 1];
      if (!path) {
        throw new Error("--path requires a value");
      }
      paths.push(path);
      index += 1;
      continue;
    }
    if (arg === "--max-patterns") {
      maxPatterns = parsePositiveInteger(argv[index + 1], arg);
      index += 1;
      continue;
    }
    if (arg === "--max-results" || arg === "--max-results-per-source") {
      maxResultsPerSource = parsePositiveInteger(argv[index + 1], arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    }
    queryParts.push(arg);
  }

  const query = queryParts.join(" ").trim();
  if (!query) {
    throw new Error("query is required");
  }

  return {
    query,
    json,
    sources,
    resultsDisplayMode,
    paths,
    maxPatterns,
    maxResultsPerSource,
    debug,
  };
}

export function searchInputFromParsedArgs(
  args: ParsedArgs
): SearchSessionsInput {
  return {
    query: args.query,
    sources: args.sources.length > 0 ? args.sources : undefined,
    resultsDisplayMode: args.resultsDisplayMode,
    paths: args.paths.length > 0 ? args.paths : undefined,
    maxPatterns: args.maxPatterns,
    maxResultsPerSource: args.maxResultsPerSource,
    debug: args.debug || undefined,
  };
}

export async function main(
  argv = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
) {
  if (isHelpRequest(argv)) {
    console.log(cliHelpText());
    return;
  }
  if (isVersionRequest(argv)) {
    console.log(packageVersion());
    return;
  }

  const args = parseArgs(argv);
  const search = createSessionSearch(searchOptionsFromEnv(env));
  const result = await search.searchSessions(searchInputFromParsedArgs(args));

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

function isHelpRequest(argv: string[]) {
  return argv.length === 1 && ["help", "--help", "-h"].includes(argv[0]);
}

function isVersionRequest(argv: string[]) {
  return argv.length === 1 && ["version", "--version", "-v"].includes(argv[0]);
}

function packageVersion() {
  const packageJsonPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json"
  );
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };
  return typeof packageJson.version === "string"
    ? packageJson.version
    : "unknown";
}

function parseResultsDisplayMode(
  value: string | undefined,
  option: string
): ResultsDisplayMode {
  if (!value) {
    throw new Error(`${option} requires a value`);
  }
  if (value === "candidates" || value === "evidence" || value === "debug") {
    return value;
  }
  throw new Error(`${option} must be one of: candidates, evidence, debug`);
}

function parsePositiveInteger(value: string | undefined, option: string) {
  if (!value) {
    throw new Error(`${option} requires a value`);
  }
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  throw new Error(`${option} must be a positive integer`);
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage());
    process.exitCode = 1;
  });
}

function isEntrypoint(moduleUrl: string, argvPath: string | undefined) {
  if (!argvPath) {
    return false;
  }
  return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
}
