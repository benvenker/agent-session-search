import { access, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { basename } from "node:path/posix";
import type { SearchWarning, SourceName } from "./types.js";

export type SessionRootConfig = {
  name: SourceName;
  path: string;
  include?: string[];
  enabled?: boolean;
};

export type ResolvedSessionSource = {
  name: SourceName;
  root: string;
  include?: string[];
  status: "ok" | "missing" | "failed";
  warning?: string;
};

export type InspectedSessionSource = {
  name: SourceName;
  root: string;
  include?: string[];
  enabled: boolean;
  status: "ok" | "missing" | "failed" | "disabled";
  warning?: string;
};

export type ResolveSessionRootsInput = {
  sources?: SourceName[] | "all";
  configPath?: string;
  config?: ConfigFile;
  defaultRoots?: SessionRootConfig[];
};

export type ResolveSessionRootsOutput = {
  sources: ResolvedSessionSource[];
  warnings: SearchWarning[];
};

export type InspectSessionSourcesOutput = {
  command: "sources";
  configPath: string;
  sources: InspectedSessionSource[];
  warnings: SearchWarning[];
};

export type SearchDefaultsConfig = {
  maxPatterns?: number;
  maxResultsPerSource?: number;
  context?: number;
};

export type ConfigFile = {
  roots?: SessionRootConfig[];
  synonyms?: Record<string, string[]>;
  defaults?: SearchDefaultsConfig;
};

export function defaultConfigPath(home = homedir()) {
  return join(home, ".config", "agent-session-search", "config.json");
}

export function defaultSessionRoots(home = homedir()): SessionRootConfig[] {
  return [
    {
      name: "codex",
      path: join(home, ".codex"),
      include: [
        "sessions/*.jsonl",
        "sessions/**/*.jsonl",
        "archived_sessions/*.jsonl",
        "archived_sessions/**/*.jsonl",
      ],
    },
    {
      name: "claude",
      path: join(home, ".claude", "projects"),
      include: ["*.jsonl"],
    },
    {
      name: "pi",
      path: join(home, ".pi", "agent", "sessions"),
      include: ["*"],
    },
    {
      name: "cursor",
      path: join(home, ".cursor", "projects"),
      include: [
        "*/agent-transcripts/**/*.jsonl",
        "*/agent-transcripts/**/*.json",
      ],
    },
    { name: "hermes", path: join(home, ".hermes", "sessions"), include: ["*"] },
    {
      name: "gemini",
      path: join(home, ".gemini", "tmp"),
      include: ["*/chats/*.json", "*/logs.json"],
    },
    {
      name: "pool",
      path: join(home, "Library", "Application Support", "poolside"),
      include: [
        "trajectories/*.ndjson",
        "logs/*.log",
        "sessions/*.json",
        "acp/**/*.json",
      ],
    },
  ];
}

export async function resolveSessionRoots(
  input: ResolveSessionRootsInput = {}
): Promise<ResolveSessionRootsOutput> {
  const configuredRoots = (
    input.config ?? (await loadSearchConfig(input.configPath))
  ).roots;
  const baseRoots = input.defaultRoots ?? defaultSessionRoots();
  const roots = configuredRoots
    ? mergeRootConfigs(baseRoots, configuredRoots)
    : baseRoots;
  const enabledRoots = roots.filter((root) => root.enabled !== false);
  const selectedRoots =
    input.sources && input.sources !== "all"
      ? enabledRoots.filter((root) => input.sources?.includes(root.name))
      : enabledRoots;

  const sources: ResolvedSessionSource[] = [];
  const warnings: SearchWarning[] = [];

  if (input.sources && input.sources !== "all") {
    const enabledSourceList = enabledRoots.map((root) => root.name).join(", ");
    for (const sourceName of input.sources) {
      if (!enabledRoots.some((root) => root.name === sourceName)) {
        const suggestedSource = suggestSourceName(sourceName, enabledRoots);
        warnings.push({
          source: sourceName,
          code: "unknown_source",
          message: [
            `Requested source is not configured or is disabled: ${sourceName}.`,
            ...(suggestedSource ? [`Did you mean ${suggestedSource}?`] : []),
            `Enabled sources: ${enabledSourceList || "none"}.`,
            suggestedSource
              ? `Run \`agent-session-search sources --json\` to inspect configured source names, use \`--source ${suggestedSource}\`, or omit --source to search all enabled sources.`
              : "Run `agent-session-search sources --json` to inspect configured source names, or omit --source to search all enabled sources.",
          ].join(" "),
          recommendedAction: suggestedSource
            ? `Use \`--source ${suggestedSource}\`, run \`agent-session-search sources --json\`, or omit --source to search all enabled sources.`
            : "Run `agent-session-search sources --json`, or omit --source to search all enabled sources.",
        });
      }
    }
    if (selectedRoots.length === 0) {
      warnings.push({
        code: "no_sources_selected",
        message: `No enabled configured sources matched the requested source filter. Enabled sources: ${enabledSourceList || "none"}. Omit --source or choose one of the enabled sources.`,
        recommendedAction:
          "Omit --source to search all enabled sources, or run `agent-session-search sources --json` and retry with one enabled source name.",
      });
    }
  }

  for (const source of selectedRoots) {
    const resolved = await resolveOneRoot(source);
    sources.push(resolved);
    if (resolved.warning) {
      warnings.push({
        source: source.name,
        root: source.path,
        code:
          resolved.status === "missing" ? "missing_root" : "unreadable_root",
        message: resolved.warning,
        recommendedAction: rootWarningRecommendedAction(resolved.status),
      });
    }
  }

  return { sources, warnings };
}

export async function inspectSessionSources(
  input: Omit<ResolveSessionRootsInput, "sources"> = {}
): Promise<InspectSessionSourcesOutput> {
  const configPath = input.configPath ?? defaultConfigPath();
  const configuredRoots = (input.config ?? (await loadSearchConfig(configPath)))
    .roots;
  const baseRoots = input.defaultRoots ?? defaultSessionRoots();
  const roots = configuredRoots
    ? mergeRootConfigs(baseRoots, configuredRoots)
    : baseRoots;
  const warnings: SearchWarning[] = [];
  const sources: InspectedSessionSource[] = [];

  for (const root of roots) {
    const enabled = root.enabled !== false;
    if (!enabled) {
      sources.push({
        name: root.name,
        root: root.path,
        include: root.include,
        enabled,
        status: "disabled",
      });
      continue;
    }

    const resolved = await resolveOneRoot(root);
    sources.push({
      name: resolved.name,
      root: resolved.root,
      include: resolved.include,
      enabled,
      status: resolved.status,
      warning: resolved.warning,
    });
    if (resolved.warning) {
      warnings.push({
        source: root.name,
        root: root.path,
        code:
          resolved.status === "missing" ? "missing_root" : "unreadable_root",
        message: resolved.warning,
        recommendedAction: rootWarningRecommendedAction(resolved.status),
      });
    }
  }

  return {
    command: "sources",
    configPath,
    sources,
    warnings,
  };
}

export function mergeRootConfigs(
  defaults: SessionRootConfig[],
  configured: SessionRootConfig[]
): SessionRootConfig[] {
  const merged = [...defaults];
  const indexesByName = new Map(
    defaults.map((root, index) => [root.name, index])
  );

  for (const root of configured) {
    const existingIndex = indexesByName.get(root.name);
    if (existingIndex === undefined) {
      indexesByName.set(root.name, merged.length);
      merged.push(root);
      continue;
    }
    merged[existingIndex] = root;
  }

  return merged;
}

export async function loadSearchConfig(
  configPath = defaultConfigPath()
): Promise<ConfigFile> {
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as ConfigFile;
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }
    throw error;
  }
}

async function resolveOneRoot(
  root: SessionRootConfig
): Promise<ResolvedSessionSource> {
  try {
    await access(root.path, constants.R_OK | constants.X_OK);
    return {
      name: root.name,
      root: await realpath(root.path),
      include: root.include,
      status: "ok",
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        name: root.name,
        root: root.path,
        include: root.include,
        status: "missing",
        warning: `Configured root does not exist: ${root.path}`,
      };
    }
    return {
      name: root.name,
      root: root.path,
      include: root.include,
      status: "failed",
      warning: `Configured root is not readable: ${root.path}`,
    };
  }
}

export function pathMatchesInclude(
  root: string,
  path: string,
  include: string[] | undefined
) {
  if (!include?.length || include.includes("*")) {
    return true;
  }

  const relativePath = toPosixRelative(root, path);
  if (relativePath === undefined) {
    return false;
  }

  return include.some((pattern) => {
    if (!pattern.includes("/")) {
      return globMatches(basename(relativePath), pattern);
    }
    return globMatches(relativePath, pattern);
  });
}

function toPosixRelative(root: string, path: string) {
  const relativePath = relative(root, path);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    relativePath.startsWith(`..${sep}`)
  ) {
    return undefined;
  }
  return relativePath.split(sep).join("/");
}

function globMatches(value: string, pattern: string) {
  return globToRegExp(pattern).test(value);
}

function globToRegExp(pattern: string) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(char);
  }
  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value: string) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function isMissingFileError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function rootWarningRecommendedAction(status: ResolvedSessionSource["status"]) {
  if (status === "missing") {
    return "Create the directory, update or disable this source in the agent-session-search config, or run `agent-session-search sources --json` to inspect configured roots.";
  }
  return "Fix filesystem permissions for this root, update or disable this source in the agent-session-search config, or run `agent-session-search sources --json` to inspect configured roots.";
}

function suggestSourceName(
  sourceName: SourceName,
  enabledRoots: SessionRootConfig[]
) {
  let best: { name: SourceName; distance: number } | undefined;
  for (const root of enabledRoots) {
    const distance = damerauLevenshtein(sourceName, root.name);
    if (!best || distance < best.distance) {
      best = { name: root.name, distance };
    }
  }
  return best && best.distance <= 2 ? best.name : undefined;
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
