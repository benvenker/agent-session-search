import { access, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

export type ResolveSessionRootsInput = {
  sources?: SourceName[] | "all";
  configPath?: string;
  defaultRoots?: SessionRootConfig[];
};

export type ResolveSessionRootsOutput = {
  sources: ResolvedSessionSource[];
  warnings: SearchWarning[];
};

type ConfigFile = {
  roots?: SessionRootConfig[];
  synonyms?: Record<string, string[]>;
};

export function defaultConfigPath(home = homedir()) {
  return join(home, ".config", "agent-session-search", "config.json");
}

export function defaultSessionRoots(home = homedir()): SessionRootConfig[] {
  return [
    { name: "codex", path: join(home, ".codex", "sessions"), include: ["*.jsonl"] },
    { name: "claude", path: join(home, ".claude", "projects"), include: ["*.jsonl"] },
    { name: "pi", path: join(home, ".pi", "agent", "sessions"), include: ["*"] },
    { name: "cursor", path: join(home, ".cursor", "projects"), include: ["*/agent-transcripts/*"] },
    { name: "hermes", path: join(home, ".hermes", "sessions"), include: ["*"] },
  ];
}

export async function resolveSessionRoots(
  input: ResolveSessionRootsInput = {},
): Promise<ResolveSessionRootsOutput> {
  const configuredRoots = (await loadSearchConfig(input.configPath)).roots;
  const baseRoots = input.defaultRoots ?? defaultSessionRoots();
  const roots = configuredRoots ? mergeRootConfigs(baseRoots, configuredRoots) : baseRoots;
  const enabledRoots = roots.filter((root) => root.enabled !== false);
  const selectedRoots =
    input.sources && input.sources !== "all"
      ? enabledRoots.filter((root) => input.sources?.includes(root.name))
      : enabledRoots;

  const sources: ResolvedSessionSource[] = [];
  const warnings: SearchWarning[] = [];

  for (const source of selectedRoots) {
    const resolved = await resolveOneRoot(source);
    sources.push(resolved);
    if (resolved.warning) {
      warnings.push({
        source: source.name,
        root: source.path,
        code: resolved.status === "missing" ? "missing_root" : "unreadable_root",
        message: resolved.warning,
      });
    }
  }

  return { sources, warnings };
}

export function mergeRootConfigs(
  defaults: SessionRootConfig[],
  configured: SessionRootConfig[],
): SessionRootConfig[] {
  const merged = [...defaults];
  const indexesByName = new Map(defaults.map((root, index) => [root.name, index]));

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

export async function loadSearchConfig(configPath = defaultConfigPath()): Promise<ConfigFile> {
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as ConfigFile;
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }
    throw error;
  }
}

async function resolveOneRoot(root: SessionRootConfig): Promise<ResolvedSessionSource> {
  try {
    await access(root.path, constants.R_OK);
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

function isMissingFileError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
