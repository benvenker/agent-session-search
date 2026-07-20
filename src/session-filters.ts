import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

const DAY_MS = 86_400_000;

export function encodeWorkspaceDirName(workspace: string): string {
  return workspace.replace(/[^a-zA-Z0-9]/g, "-");
}

export function stripDashes(value: string): string {
  return value.replace(/^-+|-+$/g, "");
}

export function workspaceEncodedSegmentMatch(
  recordedPath: string,
  encodedWorkspace: string | readonly string[]
): boolean {
  const encodedForms = Array.isArray(encodedWorkspace)
    ? encodedWorkspace
    : [encodedWorkspace];
  const expected = new Set(encodedForms.map(stripDashes));
  return recordedPath
    .split(/[\\/]/)
    .some(
      (segment) => segment.startsWith("-") && expected.has(stripDashes(segment))
    );
}

export type CanonicalWorkspace = {
  resolvedPath: string;
  realPath?: string;
  canonicalPath: string;
  forms: string[];
};

export async function canonicalWorkspacePath(
  workspace: string
): Promise<CanonicalWorkspace> {
  const home = homedir();
  const expanded =
    workspace === "~"
      ? home
      : workspace.startsWith("~/") || workspace.startsWith("~\\")
        ? resolve(home, workspace.slice(2))
        : workspace;
  const resolvedPath = normalize(resolve(expanded));
  let realPath: string | undefined;
  try {
    realPath = normalize(await realpath(resolvedPath));
  } catch {
    // Missing workspaces retain their deterministic normalized absolute form.
  }
  const forms =
    realPath !== undefined && realPath !== resolvedPath
      ? [resolvedPath, realPath]
      : [resolvedPath];
  return {
    resolvedPath,
    ...(realPath === undefined ? {} : { realPath }),
    canonicalPath: realPath ?? resolvedPath,
    forms,
  };
}

export type SessionFileReference = {
  source: string;
  path: string;
};

export type SessionFileFilterDropReason = "days" | "workspace" | "stat_failed";

export type SessionFileFilterVerdict =
  | { passes: true }
  | { passes: false; reason: SessionFileFilterDropReason };

export type SessionFileFilterInput = {
  days?: number;
  workspace?: string;
};

export type SessionFileFilterDependencies = {
  now?: () => number;
  getMtimeMs?: (result: SessionFileReference) => Promise<number | undefined>;
  getMetadataProjectPaths?: (result: SessionFileReference) => Promise<string[]>;
};

export type PreparedSessionFileFilters = {
  days?: number;
  workspace?: string;
  workspaceExists?: boolean;
  workspaceForms?: string[];
  workspaceEncodedForms?: string[];
  cutoff?: number;
  getMtimeMs: (result: SessionFileReference) => Promise<number | undefined>;
  getMetadataProjectPaths?: (result: SessionFileReference) => Promise<string[]>;
  verdicts: Map<string, Promise<SessionFileFilterVerdict>>;
};

export async function prepareSessionFileFilters(
  input: SessionFileFilterInput,
  dependencies: SessionFileFilterDependencies = {}
): Promise<PreparedSessionFileFilters> {
  const canonicalWorkspace =
    input.workspace === undefined
      ? undefined
      : await canonicalWorkspacePath(input.workspace);
  const cutoff =
    input.days === undefined
      ? undefined
      : (dependencies.now ?? Date.now)() - input.days * DAY_MS;

  return {
    days: input.days,
    workspace: canonicalWorkspace?.canonicalPath,
    workspaceExists:
      canonicalWorkspace === undefined
        ? undefined
        : canonicalWorkspace.realPath !== undefined,
    workspaceForms: canonicalWorkspace?.forms,
    workspaceEncodedForms:
      canonicalWorkspace === undefined
        ? undefined
        : canonicalWorkspace.forms.map(encodeWorkspaceDirName),
    cutoff,
    getMtimeMs:
      dependencies.getMtimeMs ??
      (async ({ path }) => {
        try {
          return (await stat(path)).mtimeMs;
        } catch {
          return undefined;
        }
      }),
    getMetadataProjectPaths: dependencies.getMetadataProjectPaths,
    verdicts: new Map(),
  };
}

export function resultPassesSessionFileFilters(
  result: SessionFileReference,
  filters: PreparedSessionFileFilters
): Promise<SessionFileFilterVerdict> {
  const key = `${result.source}\u0000${result.path}`;
  const existing = filters.verdicts.get(key);
  if (existing) return existing;

  const verdict = evaluateResult(result, filters);
  filters.verdicts.set(key, verdict);
  return verdict;
}

export type SessionFileFilterApplication<T extends SessionFileReference> = {
  results: T[];
  dropped: Array<{
    result: T;
    reason: SessionFileFilterDropReason;
  }>;
};

export async function applySessionFileFilters<T extends SessionFileReference>(
  results: T[],
  filters: PreparedSessionFileFilters
): Promise<SessionFileFilterApplication<T>> {
  const verdicts = await Promise.all(
    results.map((result) => resultPassesSessionFileFilters(result, filters))
  );
  const application: SessionFileFilterApplication<T> = {
    results: [],
    dropped: [],
  };
  results.forEach((result, index) => {
    const verdict = verdicts[index];
    if (verdict?.passes) {
      application.results.push(result);
    } else if (verdict) {
      application.dropped.push({ result, reason: verdict.reason });
    }
  });
  return application;
}

async function evaluateResult(
  result: SessionFileReference,
  filters: PreparedSessionFileFilters
): Promise<SessionFileFilterVerdict> {
  const workspaceMatchedEarly =
    filters.workspaceForms === undefined ||
    (filters.workspaceExists === true &&
      resultMatchesWorkspacePath(result, filters));
  if (filters.cutoff !== undefined) {
    let mtime: number | undefined;
    try {
      mtime = await filters.getMtimeMs(result);
    } catch {
      return { passes: false, reason: "stat_failed" };
    }
    if (mtime === undefined) {
      return { passes: false, reason: "stat_failed" };
    }
    if (mtime < filters.cutoff) {
      return { passes: false, reason: "days" };
    }
  }
  if (!workspaceMatchedEarly) {
    if (filters.workspaceExists === false) {
      return { passes: false, reason: "workspace" };
    }
    if (!(await resultMatchesWorkspaceMetadata(result, filters))) {
      return { passes: false, reason: "workspace" };
    }
  }
  return { passes: true };
}

export async function resultIsAssociatedWithWorkspace(
  result: SessionFileReference,
  filters: PreparedSessionFileFilters
): Promise<boolean> {
  if (filters.workspaceForms === undefined) return true;
  return (
    resultMatchesWorkspacePath(result, filters) ||
    (await resultMatchesWorkspaceMetadata(result, filters))
  );
}

function resultMatchesWorkspacePath(
  result: SessionFileReference,
  filters: PreparedSessionFileFilters
) {
  return (
    filters.workspaceForms?.some((workspace) =>
      pathIsWithin(result.path, workspace)
    ) === true ||
    workspaceEncodedSegmentMatch(
      result.path,
      filters.workspaceEncodedForms ?? []
    )
  );
}

async function resultMatchesWorkspaceMetadata(
  result: SessionFileReference,
  filters: PreparedSessionFileFilters
) {
  let metadataProjectPaths: string[] = [];
  try {
    metadataProjectPaths =
      (await filters.getMetadataProjectPaths?.(result)) ?? [];
  } catch {
    // Unreadable metadata is simply unable to prove a workspace match.
  }
  return metadataProjectPaths.some((projectPath) =>
    filters.workspaceForms?.some((workspace) =>
      pathIsWithin(projectPath, workspace)
    )
  );
}

function pathIsWithin(candidatePath: string, workspacePath: string): boolean {
  const child = normalize(candidatePath);
  const parent = normalize(workspacePath);
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent === "" ||
    (pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromParent))
  );
}
