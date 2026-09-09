import { spawn } from "node:child_process";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathMatchesInclude } from "./roots.js";
import { trackChildProcessPid } from "./child-process-cleanup.js";
import type { SearchResult, SearchWarning, SourceName } from "./types.js";

// FFF MCP 0.9.6 and 0.10.6 hardcode this limit in make_grep_options.
const FFF_MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_MATCHES = 1000;
const MAX_FILES = 10_000;
const EXCERPT_BYTES = 2048;

type Input = {
  source: SourceName;
  root: string;
  patterns: string[];
  paths?: string[];
  include?: string[];
  timeoutMs?: number;
  maxResults?: number;
  eligiblePath?: (path: string) => Promise<boolean>;
};

export async function searchOversizedFiles(input: Input): Promise<{
  results: SearchResult[];
  warnings: SearchWarning[];
  filesSearched: number;
}> {
  const results: SearchResult[] = [];
  const warnings: SearchWarning[] = [];
  let filesSearched = 0;
  const deadline = Date.now() + (input.timeoutMs ?? 15_000);
  const resultLimit = Math.min(input.maxResults ?? MAX_MATCHES, MAX_MATCHES);
  const warning = (code: string, message: string): SearchWarning => ({
    source: input.source,
    root: input.root,
    code,
    message,
  });
  const reportError = (error: unknown) => {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    warnings.push({
      ...warning(
        "ripgrep_fallback_error",
        missing
          ? "Ripgrep or a selected transcript is unavailable; oversized transcript search is incomplete."
          : `Oversized transcript search is incomplete: ${error instanceof Error ? error.message : String(error)}`
      ),
      recommendedAction:
        "Ensure rg (ripgrep) is installed on PATH and the selected transcript is readable, then retry.",
    });
  };

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

  try {
    let visited = 0;
    const oversized = new Set<string>();
    const candidates = input.paths?.length
      ? selectedPaths(input.paths)
      : walkFiles(root, input.include, deadline, reportError);
    for await (const path of candidates) {
      if (++visited > MAX_FILES || Date.now() >= deadline) {
        warnings.push(
          warning(
            "ripgrep_fallback_limit",
            "Oversized transcript discovery reached its file or time budget; narrow the source or select evidence paths."
          )
        );
        break;
      }
      if (!withinRoot(root, path) && !withinRoot(input.root, path)) continue;
      try {
        const canonical = await realpath(path);
        if (
          !withinRoot(root, canonical) ||
          !pathMatchesInclude(root, canonical, input.include)
        ) {
          continue;
        }
        const info = await stat(canonical);
        if (!info.isFile() || info.size <= FFF_MAX_FILE_BYTES) {
          continue;
        }
        if (input.eligiblePath && !(await input.eligiblePath(canonical)))
          continue;
        oversized.add(canonical);
      } catch (error) {
        reportError(error);
      }
    }
    const searched = new Set<string>();
    const byLine = new Map<string, SearchResult>();
    // Preserve the query planner's exact-first order across every file.
    search: for (const pattern of input.patterns) {
      for (const path of oversized) {
        if (Date.now() >= deadline) {
          warnings.push(
            warning(
              "ripgrep_fallback_limit",
              "Oversized transcript search exceeded its time budget; results are partial."
            )
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
            const key = `${path}\0${match.line}`;
            const existing = byLine.get(key);
            if (existing) {
              if (!existing.patterns!.includes(pattern))
                existing.patterns!.push(pattern);
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
            warnings.push(
              warning(
                "ripgrep_fallback_limit",
                `Ripgrep reached its match budget for ${path}; results are partial.`
              )
            );
          }
          if (results.length >= resultLimit) break search;
        } catch (error) {
          reportError(error);
          if ((error as NodeJS.ErrnoException).syscall === "spawn rg")
            break search;
        }
      }
    }
  } catch (error) {
    reportError(error);
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

function withinRoot(root: string, path: string) {
  const part = relative(root, path);
  return (
    part !== "" &&
    part !== ".." &&
    !part.startsWith(`..${sep}`) &&
    !isAbsolute(part)
  );
}

async function* selectedPaths(paths: string[]) {
  yield* new Set(paths);
}

async function* walkFiles(
  root: string,
  include: string[] | undefined,
  deadline: number,
  reportError: (error: unknown) => void
): AsyncGenerator<string> {
  const prefixes = include?.map((pattern) => pattern.split("/")[0]);
  const pending =
    include?.length &&
    include.every((pattern) => pattern.includes("/")) &&
    prefixes?.every((prefix) => !/[*?[{]/.test(prefix))
      ? [...new Set(prefixes.map((prefix) => join(root, prefix)))]
      : [root];
  let entries = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    if (Date.now() >= deadline)
      throw new Error(
        "Oversized transcript discovery exceeded its time budget; narrow the source or select evidence paths."
      );
    try {
      const canonical = await realpath(directory);
      if (canonical !== root && !withinRoot(root, canonical)) continue;
      for (const entry of await readdir(canonical, { withFileTypes: true })) {
        if (++entries > MAX_FILES)
          throw new Error(
            "Oversized transcript discovery exceeded its file budget; narrow the source or select evidence paths."
          );
        const path = join(directory, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile()) yield path;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        reportError(error);
      if (entries > MAX_FILES) return;
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
    let count = 0;
    let limited = false;
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
      if (limited || failure) return;
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
        if (++count >= maxMatches) {
          limited = true;
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
      failure = error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      untrack?.();
      if (failure) reject(failure);
      else if (timedOut)
        reject(new Error("Ripgrep exceeded the search time budget."));
      else if (!limited && code !== 0 && code !== 1)
        reject(
          new Error(`Ripgrep exited with status ${code}: ${stderr.trim()}`)
        );
      else resolve({ hits: [...hits.values()], limited });
    });
  });
}
