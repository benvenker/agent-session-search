import { spawn } from "node:child_process";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { trackChildProcessPid } from "./child-process-cleanup.js";
import { pathMatchesInclude } from "./roots.js";
import {
  pathIsWithin,
  resultPassesSessionFileFilters,
  type PreparedSessionFileFilters,
} from "./session-filters.js";
import type {
  SearchBackendMetadata,
  SearchResult,
  SearchWarning,
  SourceName,
} from "./types.js";

// FFF MCP 0.9.6 and 0.10.6 hardcode this limit in make_grep_options.
const FFF_MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_MATCHES = 1000;
const MAX_FILES = 10_000;
const EXCERPT_BYTES = 2048;
const DEFAULT_TIMEOUT_MS = 15_000;
const UNREADABLE_DIRECTORY_MESSAGE =
  "A directory under the source root was unreadable; oversized transcript discovery continued.";

class RipgrepMissingError extends Error {
  readonly code = "ENOENT";

  constructor() {
    super("rg");
    this.name = "RipgrepMissingError";
  }
}

export type OversizedSearchInput = {
  source: SourceName;
  root: string;
  patterns: string[];
  paths?: string[];
  include?: string[];
  timeoutMs?: number;
  maxResults?: number;
  oversizedFileLimitBytes?: number;
  filters?: PreparedSessionFileFilters;
};

export type OversizedSearchOutput = {
  results: SearchResult[];
  warnings: SearchWarning[];
  filesSearched: number;
};

export async function applyOversizedFallback(
  output: {
    results: SearchResult[];
    warnings: SearchWarning[];
    backend?: SearchBackendMetadata;
  },
  input: OversizedSearchInput
): Promise<{
  results: SearchResult[];
  warnings: SearchWarning[];
  backend: SearchBackendMetadata;
}> {
  if (
    input.maxResults !== undefined &&
    output.results.length >= input.maxResults
  ) {
    return {
      results: output.results.slice(0, input.maxResults),
      warnings: output.warnings,
      backend: output.backend ?? { mode: "custom" },
    };
  }

  const remaining =
    input.maxResults === undefined
      ? undefined
      : Math.max(input.maxResults - output.results.length, 0);
  const oversized = await searchOversizedFiles({
    ...input,
    maxResults: remaining,
  });
  const results = output.results.slice();
  mergeHits(results, oversized.results);
  return {
    results:
      input.maxResults === undefined
        ? results
        : results.slice(0, input.maxResults),
    warnings: [...output.warnings, ...oversized.warnings],
    backend: {
      mode: "custom",
      ...output.backend,
      ...(oversized.filesSearched > 0
        ? {
            oversizedFallback: {
              engine: "ripgrep" as const,
              filesSearched: oversized.filesSearched,
            },
          }
        : {}),
    },
  };
}

export async function searchOversizedFiles(
  input: OversizedSearchInput
): Promise<OversizedSearchOutput> {
  const results: SearchResult[] = [];
  const warnings: SearchWarning[] = [];
  let filesSearched = 0;
  const budgetMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const warning = (code: string, message: string): SearchWarning => ({
    source: input.source,
    root: input.root,
    code,
    message,
  });
  const limitWarning = (message: string) => {
    if (warnings.some((item) => item.code === "ripgrep_fallback_limit")) return;
    warnings.push(warning("ripgrep_fallback_limit", message));
  };
  const reportUnreadableDirectory = () => {
    if (
      warnings.some(
        (item) =>
          item.code === "ripgrep_fallback_error" &&
          item.message === UNREADABLE_DIRECTORY_MESSAGE
      )
    ) {
      return;
    }
    warnings.push({
      ...warning("ripgrep_fallback_error", UNREADABLE_DIRECTORY_MESSAGE),
      recommendedAction:
        "Ensure session directories under the source root are readable, then retry.",
    });
  };
  const reportError = (error: unknown) => {
    if (error instanceof RipgrepMissingError) {
      warnings.push({
        ...warning(
          "ripgrep_fallback_error",
          "Ripgrep is unavailable; oversized transcript search is incomplete."
        ),
        recommendedAction:
          "Ensure rg (ripgrep) is installed on PATH, then retry.",
      });
      return;
    }
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    warnings.push({
      ...warning(
        "ripgrep_fallback_error",
        missing
          ? "A selected transcript is unavailable; oversized transcript search is incomplete."
          : `Oversized transcript search is incomplete: ${error instanceof Error ? error.message : String(error)}`
      ),
      recommendedAction: missing
        ? "Ensure the selected transcript is readable, then retry."
        : "Ensure rg (ripgrep) is installed on PATH and the selected transcript is readable, then retry.",
    });
  };

  if (budgetMs <= 0) {
    limitWarning(
      "Oversized transcript search exceeded its time budget; results are partial."
    );
    return { results, warnings, filesSearched };
  }

  const deadline = Date.now() + budgetMs;
  const resultLimit = Math.min(input.maxResults ?? MAX_MATCHES, MAX_MATCHES);
  const oversizedFileLimitBytes =
    input.oversizedFileLimitBytes ?? FFF_MAX_FILE_BYTES;

  let root: string;
  try {
    root = await realpath(input.root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push(
        warning(
          "ripgrep_fallback_error",
          "Unable to inspect the source root for oversized transcripts."
        )
      );
    }
    return { results, warnings, filesSearched };
  }

  const oversized = new Set<string>();
  const budget: DiscoveryBudget = {
    deadline,
    maxEntries: MAX_FILES,
    entries: 0,
    limited: false,
  };
  const consider = async (path: string) => {
    if (!pathIsWithin(path, root) && !pathIsWithin(path, input.root)) return;
    try {
      const canonical = await realpath(path);
      if (
        !pathIsWithin(canonical, root) ||
        !pathMatchesInclude(root, canonical, input.include)
      ) {
        return;
      }
      const info = await stat(canonical);
      if (!info.isFile() || info.size <= oversizedFileLimitBytes) {
        return;
      }
      if (
        input.filters &&
        !(
          await resultPassesSessionFileFilters(
            { source: input.source, path: canonical },
            input.filters
          )
        ).passes
      ) {
        return;
      }
      oversized.add(canonical);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      reportError(error);
    }
  };

  if (input.paths?.length) {
    for (const path of new Set(input.paths)) {
      if (++budget.entries > budget.maxEntries || Date.now() >= deadline) {
        budget.limited = true;
        break;
      }
      await consider(path);
    }
  } else {
    for await (const path of walkFiles(
      root,
      budget,
      reportUnreadableDirectory
    )) {
      await consider(path);
    }
  }
  if (budget.limited) {
    limitWarning(
      "Oversized transcript discovery reached its file or time budget; narrow the source or select evidence paths."
    );
  }

  const searched = new Set<string>();
  const byLine = new Map<string, SearchResult>();
  // Preserve the query planner's exact-first order across every file.
  search: for (const pattern of input.patterns) {
    for (const path of oversized) {
      if (Date.now() >= deadline) {
        limitWarning(
          "Oversized transcript search exceeded its time budget; results are partial."
        );
        break search;
      }
      try {
        const matches = await grepFile(
          path,
          pattern,
          deadline - Date.now(),
          resultLimit - results.length
        );
        searched.add(path);
        filesSearched = searched.size;
        for (const match of matches.hits) {
          const key = searchLineKey({
            source: input.source,
            root: input.root,
            path,
            line: match.line,
          });
          const existing = byLine.get(key);
          if (existing) {
            addPattern(existing, pattern);
            continue;
          }
          const result: SearchResult = {
            source: input.source,
            root: input.root,
            path,
            line: match.line,
            content: await readExcerpt(path, match.offset),
            pattern,
            patterns: [pattern],
          };
          results.push(result);
          byLine.set(key, result);
        }
        if (matches.limited && input.maxResults === undefined) {
          limitWarning(
            `Ripgrep reached its match budget for ${path}; results are partial.`
          );
        }
        if (results.length >= resultLimit) break search;
      } catch (error) {
        reportError(error);
        if (error instanceof RipgrepMissingError) break search;
      }
    }
  }
  return { results: results.slice(0, MAX_MATCHES), warnings, filesSearched };
}

async function readExcerpt(path: string, offset: number) {
  const file = await open(path, "r");
  try {
    const start = Math.max(0, offset - 96);
    const buffer = Buffer.alloc(EXCERPT_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const matchIndex = buffer
      .subarray(0, offset - start)
      .toString("utf8").length;
    const lineStart = text.lastIndexOf("\n", matchIndex - 1) + 1;
    const lineEnd = text.indexOf("\n", matchIndex);
    return text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  } finally {
    await file.close();
  }
}

type DiscoveryBudget = {
  deadline: number;
  maxEntries: number;
  entries: number;
  limited: boolean;
};

function walkDirectoryErrorAction(error: unknown): "skip" | "warn" | "throw" {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "skip";
  if (code === "EACCES" || code === "EPERM" || code === "ELOOP") return "warn";
  return "throw";
}

async function* walkFiles(
  root: string,
  budget: DiscoveryBudget,
  onUnreadable: () => void
): AsyncGenerator<string> {
  const pending = [root];
  while (pending.length) {
    if (Date.now() >= budget.deadline) {
      budget.limited = true;
      return;
    }
    const directory = pending.pop()!;
    try {
      const canonical = await realpath(directory);
      if (!pathIsWithin(canonical, root)) continue;
      for (const entry of await readdir(canonical, { withFileTypes: true })) {
        if (++budget.entries > budget.maxEntries) {
          budget.limited = true;
          return;
        }
        const path = join(directory, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile()) yield path;
      }
    } catch (error) {
      const action = walkDirectoryErrorAction(error);
      if (action === "skip") continue;
      if (action === "warn") {
        onUnreadable();
        continue;
      }
      throw error;
    }
  }
}

type Match = { line: number; offset: number };

function grepFile(
  path: string,
  pattern: string,
  timeoutMs: number,
  maxMatches: number
): Promise<{ hits: Match[]; limited: boolean }> {
  if (maxMatches <= 0) {
    return Promise.resolve({ hits: [], limited: false });
  }
  return new Promise((resolve, reject) => {
    // Only matching text crosses stdout, never an entire captured JSONL record.
    const child = spawn(
      "rg",
      [
        "--no-config",
        "--fixed-strings",
        "--smart-case",
        "--text",
        "--only-matching",
        "--line-number",
        "--byte-offset",
        "--no-filename",
        "--color",
        "never",
        "--max-count",
        String(maxMatches),
        "-e",
        pattern,
        "--",
        path,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const untrack =
      child.pid === undefined ? undefined : trackChildProcessPid(child.pid);
    const hits = new Map<number, Match>();
    let pending = "";
    let timedOut = false;
    let failure: Error | undefined;
    let stderr = "";
    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGKILL");
      },
      Math.max(1, timeoutMs)
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(0, 1024);
    });
    child.stdout.on("data", (chunk: string) => {
      if (failure) return;
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const record = pending.slice(0, end);
        pending = pending.slice(end + 1);
        const match = /^(\d+):(\d+):(.*)$/.exec(record);
        if (!match) {
          failure = new Error("Unexpected ripgrep match output.");
          child.kill("SIGKILL");
          return;
        }
        const line = Number(match[1]);
        if (!hits.has(line)) {
          hits.set(line, {
            line,
            offset: Number(match[2]),
          });
        }
        if (hits.size >= maxMatches) {
          child.kill("SIGKILL");
          break;
        }
      }
      if (pending.length > 64 * 1024) {
        failure = new Error("Ripgrep match output exceeded the record budget.");
        child.kill("SIGKILL");
      }
    });
    child.on("error", (error) => {
      failure =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new RipgrepMissingError()
          : error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      untrack?.();
      if (failure) reject(failure);
      else if (timedOut)
        reject(new Error("Ripgrep exceeded the search time budget."));
      else if (hits.size < maxMatches && code !== 0 && code !== 1)
        reject(
          new Error(`Ripgrep exited with status ${code}: ${stderr.trim()}`)
        );
      else
        resolve({
          hits: [...hits.values()],
          limited: hits.size >= maxMatches,
        });
    });
  });
}

function searchLineKey(
  result: Pick<SearchResult, "source" | "root" | "path" | "line">
) {
  return `${result.source}\0${result.root}\0${result.path}\0${result.line ?? ""}`;
}

function addPattern(result: SearchResult, pattern: string) {
  const patterns = result.patterns ?? (result.pattern ? [result.pattern] : []);
  if (!patterns.includes(pattern)) {
    patterns.push(pattern);
  }
  result.patterns = patterns;
  result.pattern = patterns[0];
}

function mergeHits(target: SearchResult[], incoming: SearchResult[]) {
  const byLine = new Map(
    target.map((result) => [searchLineKey(result), result])
  );
  for (const result of incoming) {
    const existing = byLine.get(searchLineKey(result));
    if (!existing) {
      target.push(result);
      byLine.set(searchLineKey(result), result);
      continue;
    }
    for (const pattern of result.patterns ??
      (result.pattern ? [result.pattern] : [])) {
      addPattern(existing, pattern);
    }
  }
}
