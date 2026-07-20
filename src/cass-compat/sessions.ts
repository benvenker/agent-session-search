import { readdir, realpath, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import {
  pathMatchesInclude,
  resolveSessionRoots,
  type ResolveSessionRootsOutput,
  type ResolvedSessionSource,
} from "../roots.js";

export type CassCompatSessionRecord = {
  source: string;
  root: string;
  path: string;
  agent: string;
  mtimeMs: number;
};

export type CassCompatSessionWarning = {
  source?: string;
  root?: string;
  code: string;
  message: string;
};

export type EnumerateCassCompatSessionsResult = {
  records: CassCompatSessionRecord[];
  warnings: CassCompatSessionWarning[];
  attemptedRoots: number;
  successfulRoots: number;
  truncatedRoots: string[];
};

export type CassCompatSessionDependencies = {
  resolveRoots?: () => Promise<ResolveSessionRootsOutput>;
};

export async function enumerateCassCompatSessions(
  options: { maxFilesPerRoot?: number } = {},
  dependencies: CassCompatSessionDependencies = {}
): Promise<EnumerateCassCompatSessionsResult> {
  const resolved = await (dependencies.resolveRoots ?? resolveSessionRoots)();
  const warnings: CassCompatSessionWarning[] = resolved.warnings.map(
    (warning) => ({
      source: warning.source,
      root: warning.root,
      code: String(warning.code),
      message: warning.message,
    })
  );
  const candidates: Array<{
    source: ResolvedSessionSource;
    path: string;
  }> = [];
  let successfulRoots = 0;

  for (const source of resolved.sources) {
    if (source.status !== "ok") {
      const message = source.warning ?? `Session root is ${source.status}`;
      if (
        !warnings.some(
          (warning) =>
            warning.source === source.name && warning.message === message
        )
      ) {
        warnings.push({
          source: source.name,
          root: source.root,
          code: `root_${source.status}`,
          message,
        });
      }
      continue;
    }

    const rootCandidates: string[] = [];
    try {
      await walkRealDirectory(source.root, rootCandidates, (path, error) => {
        warnings.push({
          source: source.name,
          root: source.root,
          code: "directory_walk_failed",
          message: `${path}: ${errorMessage(error)}`,
        });
      });
      successfulRoots += 1;
    } catch (error: unknown) {
      warnings.push({
        source: source.name,
        root: source.root,
        code: "root_walk_failed",
        message: errorMessage(error),
      });
      continue;
    }

    for (const path of rootCandidates) candidates.push({ source, path });
  }

  const recordSlots: Array<CassCompatSessionRecord | undefined> = Array.from({
    length: candidates.length,
  });
  let cursor = 0;
  const workerCount = Math.min(16, candidates.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < candidates.length) {
        const candidateIndex = cursor;
        const candidate = candidates[candidateIndex];
        cursor += 1;
        if (!candidate) continue;
        try {
          const canonicalPath = await realpath(candidate.path);
          if (
            !pathMatchesInclude(
              candidate.source.root,
              canonicalPath,
              candidate.source.include
            )
          ) {
            continue;
          }
          const metadata = await stat(canonicalPath);
          if (!metadata.isFile()) continue;
          recordSlots[candidateIndex] = {
            source: candidate.source.name,
            root: candidate.source.root,
            path: canonicalPath,
            agent: cassAgentForSource(candidate.source.name),
            mtimeMs: metadata.mtimeMs,
          };
        } catch (error: unknown) {
          warnings.push({
            source: candidate.source.name,
            root: candidate.source.root,
            code: "file_metadata_failed",
            message: `${candidate.path}: ${errorMessage(error)}`,
          });
        }
      }
    })
  );

  const records: CassCompatSessionRecord[] = [];
  const retainedByRoot = new Map<string, number>();
  const truncatedRoots = new Set<string>();
  for (const record of recordSlots) {
    if (!record) continue;
    const retained = retainedByRoot.get(record.source) ?? 0;
    if (
      options.maxFilesPerRoot !== undefined &&
      retained >= options.maxFilesPerRoot
    ) {
      truncatedRoots.add(record.source);
      continue;
    }
    records.push(record);
    retainedByRoot.set(record.source, retained + 1);
  }

  return {
    records,
    warnings,
    attemptedRoots: resolved.sources.length,
    successfulRoots,
    truncatedRoots: [...truncatedRoots],
  };
}

export function formatCassCompatWarnings(
  warnings: readonly CassCompatSessionWarning[]
): string {
  return warnings.length === 0
    ? ""
    : `${JSON.stringify({ warnings }, null, 2)}\n`;
}

async function walkRealDirectory(
  directory: string,
  files: string[],
  onDirectoryError: (path: string, error: unknown) => void,
  isRoot = true
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (isRoot) throw error;
    onDirectoryError(directory, error);
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkRealDirectory(path, files, onDirectoryError, false);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
}

function cassAgentForSource(source: string): string {
  if (source === "claude") return "claude_code";
  if (source === "pi") return "pi_agent";
  return source;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown filesystem error";
}
