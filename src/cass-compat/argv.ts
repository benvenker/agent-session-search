export type CassCompatSearchCommand = {
  verb: "search";
  query: string;
  limit?: number;
  days?: number;
  agents: string[];
  workspace?: string;
  fields?: string[];
  robot: boolean;
  json: boolean;
};

export type CassCompatTimelineCommand = {
  verb: "timeline";
  sinceDays: number;
  json: boolean;
};

export type CassCompatExportCommand = {
  verb: "export";
  format: "markdown" | "text";
  path: string;
};

export type CassCompatVersionCommand = { verb: "version" };
export type CassCompatHealthCommand = { verb: "health"; json: boolean };
export type CassCompatStatsCommand = { verb: "stats"; json: boolean };

export type CassCompatCommand =
  | CassCompatSearchCommand
  | CassCompatTimelineCommand
  | CassCompatExportCommand
  | CassCompatVersionCommand
  | CassCompatHealthCommand
  | CassCompatStatsCommand;

export type ParseCassCompatArgvResult =
  | {
      ok: true;
      command: CassCompatCommand;
      warnings: string[];
    }
  | {
      ok: false;
      completion: CassCompatCompletion;
    };

export function parseCassCompatArgv(
  argv: readonly string[]
): ParseCassCompatArgvResult {
  const [verb, ...tokens] = argv;
  if (verb === "--version") {
    return {
      ok: true,
      command: { verb: "version" },
      warnings: unknownFlagWarnings(tokens, []),
    };
  }
  if (verb === "health" || verb === "stats") {
    return {
      ok: true,
      command: { verb, json: tokens.includes("--json") },
      warnings: unknownFlagWarnings(tokens, ["--json"]),
    };
  }
  if (verb === "search") {
    return parseSearch(tokens);
  }
  if (verb === "timeline") {
    const sinceIndex = tokens.indexOf("--since");
    const duration = tokens[sinceIndex + 1] ?? "";
    const match = /^(\d+)d?$/.exec(duration);
    const sinceDays = Number(match?.[1]);
    if (!match || !Number.isSafeInteger(sinceDays) || sinceDays <= 0) {
      return {
        ok: false,
        completion: completeUsageError(
          "Invalid value for --since: expected a positive whole number of days"
        ),
      };
    }
    return {
      ok: true,
      command: {
        verb: "timeline",
        sinceDays,
        json: tokens.includes("--json"),
      },
      warnings: unknownFlagWarnings(tokens, ["--since", "--json"]),
    };
  }
  if (verb === "export") {
    const formatIndex = tokens.indexOf("--format");
    const format = tokens[formatIndex + 1];
    const terminatorIndex = tokens.indexOf("--");
    const exportPath =
      terminatorIndex >= 0 ? tokens.slice(terminatorIndex + 1).join(" ") : "";
    if (exportPath === "") {
      return {
        ok: false,
        completion: completeUsageError("Missing export path after --"),
      };
    }
    if (format !== "markdown" && format !== "text") {
      return {
        ok: false,
        completion: completeUsageError(
          `Unsupported export format: ${format ?? "(missing)"}`
        ),
      };
    }
    return {
      ok: true,
      command: {
        verb: "export",
        format,
        path: exportPath,
      },
      warnings: unknownFlagWarnings(tokens, ["--format"], true),
    };
  }
  return {
    ok: false,
    completion: completeUsageError(
      `Unsupported cass compatibility verb: ${verb ?? "(missing)"}`
    ),
  };
}

function parseSearch(tokens: readonly string[]): ParseCassCompatArgvResult {
  const warnings: string[] = [];
  const command: CassCompatSearchCommand = {
    verb: "search",
    query: "",
    agents: [],
    robot: false,
    json: false,
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") {
      command.query = tokens.slice(index + 1).join(" ");
      break;
    }
    if (token === "--robot") {
      command.robot = true;
      continue;
    }
    if (token === "--json") {
      command.json = true;
      continue;
    }

    const value = knownFlagValue(tokens, index);
    if (token === "--agent") {
      if (value === undefined) return missingValue(token);
      command.agents.push(value);
      index += 1;
    } else if (token === "--limit") {
      const parsed = parsePositiveInteger(value);
      if (parsed === undefined) return invalidPositiveInteger(token);
      command.limit = parsed;
      index += 1;
    } else if (token === "--days") {
      const parsed = parsePositiveInteger(value);
      if (parsed === undefined) return invalidPositiveInteger(token);
      command.days = parsed;
      index += 1;
    } else if (token === "--workspace") {
      if (value === undefined) return missingValue(token);
      command.workspace = value;
      index += 1;
    } else if (token === "--fields") {
      if (value === undefined || value.trim() === "")
        return missingValue(token);
      command.fields = value.split(",").map((field) => field.trim());
      index += 1;
    } else if (token.startsWith("-")) {
      warnings.push(unknownFlagWarning(token));
    }
  }

  if (command.query === "") {
    return {
      ok: false,
      completion: completeUsageError("Missing search query after --"),
    };
  }
  return { ok: true, command, warnings };
}

function unknownFlagWarning(flag: string): string {
  return `Ignoring unknown flag ${flag} for pinned cm 0.2.12 build.`;
}

function unknownFlagWarnings(
  tokens: readonly string[],
  knownFlags: readonly string[],
  stopAtTerminator = false
): string[] {
  const known = new Set(knownFlags);
  const warnings: string[] = [];
  for (const token of tokens) {
    if (stopAtTerminator && token === "--") break;
    if (token.startsWith("-") && token !== "--" && !known.has(token)) {
      warnings.push(unknownFlagWarning(token));
    }
  }
  return warnings;
}

function knownFlagValue(
  tokens: readonly string[],
  flagIndex: number
): string | undefined {
  const value = tokens[flagIndex + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function missingValue(flag: string): ParseCassCompatArgvResult {
  return {
    ok: false,
    completion: completeUsageError(`Missing value for ${flag}`),
  };
}

function invalidPositiveInteger(flag: string): ParseCassCompatArgvResult {
  return {
    ok: false,
    completion: completeUsageError(
      `Invalid value for ${flag}: expected a positive whole number`
    ),
  };
}
import { completeUsageError, type CassCompatCompletion } from "./output.js";
