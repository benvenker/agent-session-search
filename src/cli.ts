#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isEntrypoint } from "./entrypoint.js";
import { searchOptionsFromEnv } from "./env.js";
import {
  cliCapabilities,
  cliHelpText,
  robotDocsGuide,
  robotTriage,
} from "./help.js";
import { packageVersion } from "./package-info.js";
import { inspectSessionSources } from "./roots.js";
import { createSessionSearch } from "./search.js";
import { SearchSessionsInputError } from "./tool.js";
import type {
  GroupCandidatesFollowupInput,
  ResultsDisplayMode,
  SearchSessionsInput,
} from "./types.js";

function usage() {
  return cliHelpText();
}

type ParsedArgs = {
  query: string;
  queries: string[];
  operationalContext: {
    cwd?: string;
    branch?: string;
    reason?: string;
  };
  callerSession?: {
    source: string;
    sessionId: string;
  };
  groupCandidates?: GroupCandidatesFollowupInput;
  json: boolean;
  sources: string[];
  resultsDisplayMode?: ResultsDisplayMode;
  paths: string[];
  maxPatterns?: number;
  maxResultsPerSource?: number;
  debug: boolean;
};

type ParseSuggestion = {
  unknownOption: string;
  suggestedOption: string;
  suggestedCommand: string;
};

export class CliParseError extends Error {
  readonly suggestion?: ParseSuggestion;

  constructor(message: string, suggestion?: ParseSuggestion) {
    super(message);
    this.name = "CliParseError";
    this.suggestion = suggestion;
  }
}

const KNOWN_OPTIONS = [
  "--json",
  "--source",
  "--probe",
  "--query",
  "--cwd",
  "--branch",
  "--reason",
  "--caller-source",
  "--caller-session-id",
  "--group-candidates",
  "--mode",
  "--results-display-mode",
  "--candidates",
  "--evidence",
  "--debug",
  "--path",
  "--max-patterns",
  "--max-results",
  "--max-results-per-source",
  "--robot-triage",
  "--help",
  "--version",
] as const;

const DEDUPED_BOOLEAN_OPTIONS = new Set<string>([
  "--json",
  "--candidates",
  "--evidence",
  "--debug",
  "--robot-triage",
  "--help",
  "--version",
]);

const TOP_LEVEL_ONLY_OPTIONS = new Set<string>([
  "--robot-triage",
  "--help",
  "--version",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const sources: string[] = [];
  const paths: string[] = [];
  const queries: string[] = [];
  const operationalContext: ParsedArgs["operationalContext"] = {};
  const callerSession: { source?: string; sessionId?: string } = {};
  const queryParts: string[] = [];
  let groupCandidates: GroupCandidatesFollowupInput | undefined;
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
        throw inputError("--source requires a value");
      }
      sources.push(source);
      index += 1;
      continue;
    }
    if (arg === "--probe" || arg === "--query") {
      const query = argv[index + 1];
      if (!query) {
        throw inputError(`${arg} requires a value`);
      }
      queries.push(query);
      index += 1;
      continue;
    }
    if (arg === "--cwd") {
      const cwd = argv[index + 1];
      if (!cwd) {
        throw inputError("--cwd requires a value");
      }
      operationalContext.cwd = cwd;
      index += 1;
      continue;
    }
    if (arg === "--branch") {
      const branch = argv[index + 1];
      if (!branch) {
        throw inputError("--branch requires a value");
      }
      operationalContext.branch = branch;
      index += 1;
      continue;
    }
    if (arg === "--reason") {
      const reason = argv[index + 1];
      if (!reason) {
        throw inputError("--reason requires a value");
      }
      operationalContext.reason = reason;
      index += 1;
      continue;
    }
    if (arg === "--caller-source") {
      const source = argv[index + 1];
      if (!source) {
        throw inputError("--caller-source requires a value");
      }
      callerSession.source = source;
      index += 1;
      continue;
    }
    if (arg === "--caller-session-id") {
      const sessionId = argv[index + 1];
      if (!sessionId) {
        throw inputError("--caller-session-id requires a value");
      }
      callerSession.sessionId = sessionId;
      index += 1;
      continue;
    }
    if (arg === "--group-candidates") {
      groupCandidates = parseGroupCandidatesArgument(argv[index + 1], arg);
      index += 1;
      continue;
    }
    if (arg === "--mode" || arg === "--results-display-mode") {
      resultsDisplayMode = parseResultsDisplayMode(argv[index + 1], arg, argv);
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
      resultsDisplayMode ??= "debug";
      continue;
    }
    if (arg === "--path") {
      const path = argv[index + 1];
      if (!path) {
        throw inputError("--path requires a value");
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
      throw unknownOptionError(arg, argv);
    }
    queryParts.push(arg);
  }

  const query = queryParts.join(" ").trim();
  if (!query && !groupCandidates) {
    throw inputError("query is required");
  }
  if (groupCandidates && query && query !== groupCandidates.query) {
    throw inputError(
      "query must match --group-candidates.query; run `agent-session-search --json --group-candidates @payload.json` with the exact server-prepared payload"
    );
  }
  if (
    groupCandidates &&
    resultsDisplayMode &&
    resultsDisplayMode !== "candidates"
  ) {
    throw inputError(
      "--group-candidates must use candidates mode; remove --evidence or --mode evidence"
    );
  }
  if (groupCandidates) {
    const mixedFlags = groupCandidatesMixedFlags({
      queries,
      operationalContext,
      callerSession,
      sources,
      paths,
      maxPatterns,
      maxResultsPerSource,
    });
    if (mixedFlags.length > 0) {
      throw inputError(
        `--group-candidates is a complete server-prepared payload; remove ${mixedFlags.join(
          ", "
        )} and run \`agent-session-search --json --group-candidates @payload.json\``
      );
    }
  }
  if (
    (callerSession.source === undefined) !==
    (callerSession.sessionId === undefined)
  ) {
    throw inputError(
      "--caller-source and --caller-session-id must be provided together"
    );
  }

  return {
    query: query || groupCandidates?.query || "",
    queries,
    operationalContext,
    ...(callerSession.source && callerSession.sessionId
      ? {
          callerSession: {
            source: callerSession.source,
            sessionId: callerSession.sessionId,
          },
        }
      : {}),
    ...(groupCandidates ? { groupCandidates } : {}),
    json,
    sources,
    resultsDisplayMode: groupCandidates ? "candidates" : resultsDisplayMode,
    paths,
    maxPatterns,
    maxResultsPerSource,
    debug,
  };
}

function unknownOptionError(option: string, argv: string[]) {
  const suggestedOption = suggestKnownOption(option);
  if (!suggestedOption) {
    return new CliParseError(`unknown option: ${option}`);
  }

  const message =
    option === suggestedOption && TOP_LEVEL_ONLY_OPTIONS.has(suggestedOption)
      ? `${suggestedOption} must be used as a standalone command`
      : `unknown option: ${option}; did you mean ${suggestedOption}?`;

  return new CliParseError(message, {
    unknownOption: option,
    suggestedOption,
    suggestedCommand: correctedCommand(argv, option, suggestedOption),
  });
}

function inputError(message: string) {
  return new CliParseError(message);
}

function parseGroupCandidatesArgument(
  value: string | undefined,
  option: string
): GroupCandidatesFollowupInput {
  if (!value) {
    throw inputError(
      `${option} requires a value copied from more.groupCandidates`
    );
  }

  let raw: string;
  try {
    raw = groupCandidatesInputText(value);
  } catch (error) {
    throw inputError(groupCandidatesReadErrorMessage(value, option, error));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw inputError(
      `${option} requires valid JSON copied from more.groupCandidates; use @file or - for stdin when shell quoting is awkward`
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw inputError(`${option} requires a JSON object`);
  }
  return parsed as GroupCandidatesFollowupInput;
}

function groupCandidatesReadErrorMessage(
  value: string,
  option: string,
  error: unknown
) {
  if (value === "-") {
    return `${option} could not read JSON from stdin: ${errorMessage(error)}`;
  }
  if (value.startsWith("@")) {
    const path = value.slice(1);
    return `${option} could not read JSON file ${path || "<empty>"}: ${errorMessage(error)}`;
  }
  return `${option} could not read JSON payload: ${errorMessage(error)}`;
}

function groupCandidatesInputText(value: string) {
  if (value === "-") {
    return readFileSync(0, "utf8");
  }
  if (value.startsWith("@")) {
    return readFileSync(value.slice(1), "utf8");
  }
  return value;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function groupCandidatesMixedFlags({
  queries,
  operationalContext,
  callerSession,
  sources,
  paths,
  maxPatterns,
  maxResultsPerSource,
}: {
  queries: string[];
  operationalContext: ParsedArgs["operationalContext"];
  callerSession: { source?: string; sessionId?: string };
  sources: string[];
  paths: string[];
  maxPatterns?: number;
  maxResultsPerSource?: number;
}) {
  const flags: string[] = [];
  if (queries.length > 0) {
    flags.push("--probe/--query");
  }
  if (Object.keys(operationalContext).length > 0) {
    flags.push("--cwd/--branch/--reason");
  }
  if (callerSession.source || callerSession.sessionId) {
    flags.push("--caller-source/--caller-session-id");
  }
  if (sources.length > 0) {
    flags.push("--source");
  }
  if (paths.length > 0) {
    flags.push("--path");
  }
  if (maxPatterns !== undefined) {
    flags.push("--max-patterns");
  }
  if (maxResultsPerSource !== undefined) {
    flags.push("--max-results");
  }
  return flags;
}

function suggestKnownOption(option: string) {
  const normalizedOption = stripOptionPrefix(option);
  let best: { option: string; distance: number } | undefined;

  for (const knownOption of KNOWN_OPTIONS) {
    const distance = damerauLevenshtein(
      normalizedOption,
      stripOptionPrefix(knownOption)
    );
    if (!best || distance < best.distance) {
      best = { option: knownOption, distance };
    }
  }

  if (!best) {
    return undefined;
  }

  const maxDistance = normalizedOption.length <= 4 ? 1 : 2;
  return best.distance <= maxDistance ? best.option : undefined;
}

function stripOptionPrefix(option: string) {
  return option.replace(/^--?/, "");
}

function correctedCommand(
  argv: string[],
  unknownOption: string,
  suggestedOption: string
) {
  if (TOP_LEVEL_ONLY_OPTIONS.has(suggestedOption)) {
    return ["agent-session-search", suggestedOption].map(shellQuote).join(" ");
  }

  const correctedArgs: string[] = [];
  const seenBooleanOptions = new Set<string>();
  let replaced = false;

  for (const arg of argv) {
    const correctedArg =
      !replaced && arg === unknownOption ? suggestedOption : arg;
    replaced ||= arg === unknownOption;

    if (
      DEDUPED_BOOLEAN_OPTIONS.has(correctedArg) &&
      seenBooleanOptions.has(correctedArg)
    ) {
      continue;
    }
    if (DEDUPED_BOOLEAN_OPTIONS.has(correctedArg)) {
      seenBooleanOptions.add(correctedArg);
    }
    correctedArgs.push(correctedArg);
  }

  return ["agent-session-search", ...correctedArgs].map(shellQuote).join(" ");
}

function suggestionHint(suggestion: ParseSuggestion) {
  if (suggestion.unknownOption === suggestion.suggestedOption) {
    return `Run ${suggestion.suggestedOption} as a standalone command.`;
  }
  return `Replace ${suggestion.unknownOption} with ${suggestion.suggestedOption}.`;
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function damerauLevenshtein(left: string, right: string) {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const distances = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0)
  );

  for (let row = 0; row < rows; row += 1) {
    distances[row]![0] = row;
  }
  for (let column = 0; column < columns; column += 1) {
    distances[0]![column] = column;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      let distance = Math.min(
        distances[row - 1]![column]! + 1,
        distances[row]![column - 1]! + 1,
        distances[row - 1]![column - 1]! + cost
      );

      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        distance = Math.min(distance, distances[row - 2]![column - 2]! + 1);
      }

      distances[row]![column] = distance;
    }
  }

  return distances[left.length]![right.length]!;
}

export function searchInputFromParsedArgs(
  args: ParsedArgs
): SearchSessionsInput {
  return {
    query: args.query,
    queries: args.queries.length > 0 ? args.queries : undefined,
    operationalContext:
      Object.keys(args.operationalContext).length > 0
        ? args.operationalContext
        : undefined,
    ...(args.callerSession ? { callerSession: args.callerSession } : {}),
    ...(args.groupCandidates ? { groupCandidates: args.groupCandidates } : {}),
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
  if (isJsonHelpRequest(argv)) {
    console.log(JSON.stringify(cliCapabilities(packageVersion()), null, 2));
    return;
  }
  if (isHelpRequest(argv)) {
    console.log(cliHelpText());
    return;
  }
  if (isVersionRequest(argv)) {
    console.log(packageVersion());
    return;
  }
  if (isSourcesRequest(argv)) {
    console.log(
      JSON.stringify(
        await inspectSessionSources(searchOptionsFromEnv(env)),
        null,
        2
      )
    );
    return;
  }
  if (isCapabilitiesRequest(argv)) {
    console.log(JSON.stringify(cliCapabilities(packageVersion()), null, 2));
    return;
  }
  if (isRobotDocsRequest(argv)) {
    console.log(robotDocsGuide());
    return;
  }
  if (isRobotTriageRequest(argv)) {
    console.log(JSON.stringify(robotTriage(packageVersion()), null, 2));
    return;
  }

  const args = parseArgs(argv);
  const search = createSessionSearch(searchOptionsFromEnv(env));
  try {
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
      if (warning.recommendedAction) {
        console.warn(`action: ${warning.recommendedAction}`);
      }
    }
  } finally {
    await search.close?.();
  }
}

function isHelpRequest(argv: string[]) {
  return argv.length === 1 && ["help", "--help", "-h"].includes(argv[0]);
}

function isJsonHelpRequest(argv: string[]) {
  return (
    argv.length === 2 &&
    argv.includes("--json") &&
    (argv.includes("--help") || argv.includes("-h") || argv.includes("help"))
  );
}

function isVersionRequest(argv: string[]) {
  return argv.length === 1 && ["version", "--version", "-v"].includes(argv[0]);
}

function isCapabilitiesRequest(argv: string[]) {
  return (
    argv[0] === "capabilities" && argv.slice(1).every((arg) => arg === "--json")
  );
}

function isSourcesRequest(argv: string[]) {
  return (
    argv[0] === "sources" && argv.slice(1).every((arg) => arg === "--json")
  );
}

function isRobotDocsRequest(argv: string[]) {
  return (
    argv[0] === "robot-docs" &&
    (argv.length === 1 || (argv.length === 2 && argv[1] === "guide"))
  );
}

function isRobotTriageRequest(argv: string[]) {
  return argv.length === 1 && argv[0] === "--robot-triage";
}

function parseResultsDisplayMode(
  value: string | undefined,
  option: string,
  argv: string[]
): ResultsDisplayMode {
  if (!value) {
    throw inputError(`${option} requires a value`);
  }
  if (value === "candidates" || value === "evidence" || value === "debug") {
    return value;
  }
  const suggestedMode = suggestResultsDisplayMode(value);
  if (suggestedMode) {
    throw new CliParseError(
      `${option} must be one of: candidates, evidence, debug; did you mean ${suggestedMode}?`,
      {
        unknownOption: value,
        suggestedOption: suggestedMode,
        suggestedCommand: correctedCommand(argv, value, suggestedMode),
      }
    );
  }
  throw inputError(`${option} must be one of: candidates, evidence, debug`);
}

function suggestResultsDisplayMode(
  value: string
): ResultsDisplayMode | undefined {
  let best: { mode: ResultsDisplayMode; distance: number } | undefined;
  for (const mode of ["candidates", "evidence", "debug"] as const) {
    const distance = damerauLevenshtein(value, mode);
    if (!best || distance < best.distance) {
      best = { mode, distance };
    }
  }
  return best && best.distance <= 2 ? best.mode : undefined;
}

function parsePositiveInteger(value: string | undefined, option: string) {
  if (!value) {
    throw inputError(`${option} requires a value`);
  }
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  throw inputError(`${option} must be a positive integer`);
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const suggestion =
      error instanceof CliParseError ? error.suggestion : undefined;
    const groupFollowupError =
      error instanceof SearchSessionsInputError ? error : undefined;
    if (process.argv.slice(2).includes("--json")) {
      console.error(
        JSON.stringify(
          {
            error: {
              code:
                groupFollowupError?.code ??
                (error instanceof CliParseError
                  ? "user_input_error"
                  : "upstream_failure"),
              message,
              ...(groupFollowupError
                ? {
                    invalidField: groupFollowupError.invalidField,
                    correctedShape: groupFollowupError.correctedShape,
                  }
                : {}),
              ...(suggestion
                ? {
                    hint: suggestionHint(suggestion),
                  }
                : {}),
              suggestedCommand:
                suggestion?.suggestedCommand ??
                (groupFollowupError
                  ? "Copy the exact more.groupCandidates payload and run: agent-session-search --json --group-candidates @payload.json"
                  : "agent-session-search help"),
            },
          },
          null,
          2
        )
      );
    } else {
      console.error(message);
      if (suggestion) {
        console.error(`Suggested command: ${suggestion.suggestedCommand}`);
      }
      if (groupFollowupError) {
        console.error(`Invalid field: ${groupFollowupError.invalidField}`);
        console.error(
          `Corrected shape: ${JSON.stringify(groupFollowupError.correctedShape)}`
        );
        console.error(
          "Suggested command: agent-session-search --json --group-candidates @payload.json"
        );
      }
      console.error(usage());
    }
    process.exitCode =
      error instanceof CliParseError ||
      error instanceof SearchSessionsInputError
        ? 1
        : 4;
  });
}
