#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { isEntrypoint } from "./entrypoint.js";
import { createFffMcpClient, OneRootFffBackend } from "./fff-backend.js";
import {
  assessFffMcpVersion,
  FFF_MCP_INSTALL_COMMAND,
  FFF_MCP_INSTALLER_URL,
  isNotFoundError,
  readVersionFailureMessage,
  readFffMcpVersion,
  RECOMMENDED_FFF_MCP_RELEASE,
  REQUIRED_FFF_MCP_RELEASE,
} from "./fff-runtime.js";
import { doctorHelpText } from "./help.js";
import type { SourceName } from "./types.js";

const execFileAsync = promisify(execFile);

type CheckFffMcpOptions = {
  command?: string;
  env?: NodeJS.ProcessEnv;
  skipSmoke?: boolean;
  smoke?: (input: FffSmokeInput) => Promise<FffSmokeResult>;
  listOrphans?: boolean;
  reapOrphans?: boolean;
  ensureFff?: boolean;
  yes?: boolean;
  installFffMcp?: (input: InstallFffMcpInput) => Promise<void>;
};

type CheckFffMcpResult =
  | {
      ok: true;
      command: string;
      resolvedPath?: string;
      version: string;
      requiredRelease: string;
      recommendedRelease: string;
      installCommand: string;
      path: string;
      smoke: "passed" | "skipped";
      multiGrep: "supported" | "fallback" | "skipped";
      recallEquivalence: "passed" | "failed" | "skipped";
    }
  | {
      ok: false;
      command: string;
      reason: string;
      requiredRelease: string;
      recommendedRelease: string;
      installCommand: string;
      path: string;
      canEnsureFff: boolean;
    };

type FffSmokeInput = {
  command: string;
  env: NodeJS.ProcessEnv;
};

type InstallFffMcpInput = {
  env: NodeJS.ProcessEnv;
};

type FffSmokeResult =
  | {
      ok: true;
      multiGrep: "supported" | "fallback";
      recallEquivalence: "passed" | "failed";
    }
  | {
      ok: false;
      reason: string;
    };

type DoctorParseSuggestion = {
  hint?: string;
  suggestedCommand: string;
};

class DoctorParseError extends Error {
  readonly suggestion: DoctorParseSuggestion;

  constructor(message: string, suggestion: DoctorParseSuggestion) {
    super(message);
    this.name = "DoctorParseError";
    this.suggestion = suggestion;
  }
}

export type ProcessInfo = {
  pid: number;
  ppid: number;
  command: string;
};

export type FindOrphanFffMcpProcessesOptions = {
  listProcesses?: () => Promise<ProcessInfo[]>;
};

export type ReapOrphanFffMcpProcessesOptions = {
  findOrphans?: () => Promise<ProcessInfo[]>;
  killProcess?: (pid: number, signal: NodeJS.Signals) => Promise<void> | void;
};

export type ReapOrphanFffMcpProcessesResult = {
  found: ProcessInfo[];
  reaped: number[];
  failed: Array<{ pid: number; message: string }>;
};

export async function checkFffMcp(
  options: CheckFffMcpOptions = {}
): Promise<CheckFffMcpResult> {
  const command = options.command ?? "fff-mcp";
  const env = options.env ?? process.env;
  const path = env.PATH ?? "";

  const versionResult = await checkFffMcpVersion(command, env);
  if (!versionResult.ok) {
    if (options.ensureFff && options.yes) {
      const installed = await tryInstallFffMcp(
        options.installFffMcp ?? installFffMcp,
        env
      );
      if (!installed.ok) {
        return {
          ok: false,
          command,
          reason: installed.reason,
          requiredRelease: REQUIRED_FFF_MCP_RELEASE,
          recommendedRelease: RECOMMENDED_FFF_MCP_RELEASE,
          installCommand: FFF_MCP_INSTALL_COMMAND,
          path,
          canEnsureFff: true,
        };
      }
      return checkFffMcp({ ...options, ensureFff: false });
    }
    return {
      ok: false,
      command,
      reason: versionResult.reason,
      requiredRelease: REQUIRED_FFF_MCP_RELEASE,
      recommendedRelease: RECOMMENDED_FFF_MCP_RELEASE,
      installCommand: FFF_MCP_INSTALL_COMMAND,
      path,
      canEnsureFff: true,
    };
  }

  try {
    let smokeResult: Extract<FffSmokeResult, { ok: true }> | undefined;
    if (!options.skipSmoke) {
      const smoke = await (options.smoke ?? runFffSmokeTest)({ command, env });
      if (!smoke.ok) {
        return {
          ok: false,
          command,
          reason: `${command} was found, but a live grep smoke test failed: ${smoke.reason}`,
          requiredRelease: REQUIRED_FFF_MCP_RELEASE,
          recommendedRelease: RECOMMENDED_FFF_MCP_RELEASE,
          installCommand: FFF_MCP_INSTALL_COMMAND,
          path,
          canEnsureFff: false,
        };
      }
      smokeResult = smoke;
    }

    return {
      ok: true,
      command,
      resolvedPath: await findOnPath(command, path),
      version: versionResult.version,
      requiredRelease: REQUIRED_FFF_MCP_RELEASE,
      recommendedRelease: RECOMMENDED_FFF_MCP_RELEASE,
      installCommand: FFF_MCP_INSTALL_COMMAND,
      path,
      smoke: options.skipSmoke ? "skipped" : "passed",
      multiGrep: options.skipSmoke ? "skipped" : smokeResult!.multiGrep,
      recallEquivalence: options.skipSmoke
        ? "skipped"
        : smokeResult!.recallEquivalence,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ok: false,
        command,
        reason: readVersionFailureMessage(command, error),
        requiredRelease: REQUIRED_FFF_MCP_RELEASE,
        recommendedRelease: RECOMMENDED_FFF_MCP_RELEASE,
        installCommand: FFF_MCP_INSTALL_COMMAND,
        path,
        canEnsureFff: true,
      };
    }
    return {
      ok: false,
      command,
      reason: readVersionFailureMessage(command, error),
      requiredRelease: REQUIRED_FFF_MCP_RELEASE,
      recommendedRelease: RECOMMENDED_FFF_MCP_RELEASE,
      installCommand: FFF_MCP_INSTALL_COMMAND,
      path,
      canEnsureFff: true,
    };
  }
}

async function checkFffMcpVersion(command: string, env: NodeJS.ProcessEnv) {
  try {
    const version = await readFffMcpVersion(command, env);
    const assessment = assessFffMcpVersion(version, command);
    if (!assessment.ok) {
      return assessment;
    }
    return { ok: true as const, version };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ok: false as const,
        reason: `${command} was not found on PATH`,
      };
    }
    throw error;
  }
}

async function installFffMcp(input: InstallFffMcpInput) {
  await execFileAsync("bash", ["-c", FFF_MCP_INSTALL_COMMAND], {
    env: input.env,
  });
}

async function tryInstallFffMcp(
  installer: (input: InstallFffMcpInput) => Promise<void>,
  env: NodeJS.ProcessEnv
) {
  try {
    await installer({ env });
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      reason: `Failed to run FFF MCP installer: ${installerErrorMessage(error)}`,
    };
  }
}

function installerErrorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    ("stderr" in error || "stdout" in error)
  ) {
    const output = `${"stderr" in error ? String(error.stderr ?? "") : ""}${
      "stdout" in error ? String(error.stdout ?? "") : ""
    }`.trim();
    if (output) {
      return output;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export async function findOrphanFffMcpProcesses(
  options: FindOrphanFffMcpProcessesOptions = {}
): Promise<ProcessInfo[]> {
  const processes = await (options.listProcesses ?? listProcesses)();
  return processes.filter(
    (processInfo) =>
      processInfo.ppid === 1 &&
      /(^|[/\s])fff-mcp(\s|$)/.test(processInfo.command)
  );
}

export async function reapOrphanFffMcpProcesses(
  options: ReapOrphanFffMcpProcessesOptions = {}
): Promise<ReapOrphanFffMcpProcessesResult> {
  const found = await (options.findOrphans ?? findOrphanFffMcpProcesses)();
  const killProcess =
    options.killProcess ??
    ((pid: number, signal: NodeJS.Signals) => {
      process.kill(pid, signal);
    });
  const reaped: number[] = [];
  const failed: Array<{ pid: number; message: string }> = [];

  for (const orphan of found) {
    try {
      await killProcess(orphan.pid, "SIGKILL");
      reaped.push(orphan.pid);
    } catch (error) {
      failed.push({
        pid: orphan.pid,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { found, reaped, failed };
}

export async function main(argv = process.argv.slice(2)) {
  if (isHelpRequest(argv)) {
    console.log(doctorHelpText());
    return;
  }

  const options = parseArgs(argv);
  const result = await checkFffMcp(options);

  if (result.ok) {
    console.log("FFF MCP preflight passed.");
    console.log(`command: ${result.command}`);
    if (result.resolvedPath) {
      console.log(`resolved path: ${result.resolvedPath}`);
    }
    console.log(`version: ${result.version || "unknown"}`);
    console.log(`required FFF MCP: ${result.requiredRelease}`);
    console.log(`recommended stable FFF MCP: ${result.recommendedRelease}`);
    console.log(
      `smoke: ${result.smoke === "passed" ? "live grep passed" : "skipped"}`
    );
    console.log(`multi_grep: ${result.multiGrep}`);
    console.log(`recall equivalence: ${result.recallEquivalence}`);
    console.log(`upgrade command: ${result.installCommand}`);
    console.log(`PATH: ${result.path}`);
    if (options.reapOrphans) {
      printReapOrphansResult(await reapOrphanFffMcpProcesses());
    } else if (options.listOrphans) {
      printOrphans(await findOrphanFffMcpProcesses());
    }
    return;
  }

  console.error(result.reason);
  console.error(`PATH: ${result.path}`);
  console.error("");
  console.error("Install or upgrade FFF MCP with the official installer:");
  console.error(`  ${result.installCommand}`);
  console.error(`Required minimum release: ${result.requiredRelease}`);
  console.error(`Recommended stable release: ${result.recommendedRelease}`);
  if (result.canEnsureFff) {
    console.error(
      "To let doctor run that command explicitly: agent-session-search-doctor --ensure-fff --yes"
    );
  }
  console.error("Review the installer before running it if desired:");
  console.error(`  ${FFF_MCP_INSTALLER_URL}`);
  process.exitCode = 3;
}

function parseArgs(argv: string[]): CheckFffMcpOptions {
  const options: CheckFffMcpOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--command") {
      const command = argv[index + 1];
      if (!command) {
        throw new DoctorParseError("--command requires a value", {
          hint: "Pass the fff-mcp binary after --command.",
          suggestedCommand: "agent-session-search-doctor --command <bin>",
        });
      }
      options.command = command;
      index += 1;
      continue;
    }
    if (arg === "--skip-smoke") {
      options.skipSmoke = true;
      continue;
    }
    if (arg === "--list-orphans") {
      options.listOrphans = true;
      continue;
    }
    if (arg === "--reap-orphans") {
      options.reapOrphans = true;
      continue;
    }
    if (arg === "--ensure-fff") {
      options.ensureFff = true;
      continue;
    }
    if (arg === "--yes") {
      options.yes = true;
      continue;
    }
    throw unknownOptionError(arg, argv);
  }
  if (options.yes && !options.ensureFff) {
    throw new DoctorParseError("--yes requires --ensure-fff", {
      hint: "Use --yes only when asking doctor to run the FFF installer.",
      suggestedCommand: "agent-session-search-doctor --ensure-fff --yes",
    });
  }
  if (options.ensureFff && !options.yes) {
    throw new DoctorParseError("--ensure-fff requires --yes", {
      hint: "Doctor will not install or upgrade fff-mcp unless --yes is present.",
      suggestedCommand: "agent-session-search-doctor --ensure-fff --yes",
    });
  }
  if (options.ensureFff && options.command && options.command !== "fff-mcp") {
    throw new DoctorParseError(
      "--ensure-fff only supports the default fff-mcp command",
      {
        hint: "Run the official installer for PATH-managed fff-mcp, or upgrade the custom binary manually.",
        suggestedCommand: "agent-session-search-doctor --ensure-fff --yes",
      }
    );
  }
  return options;
}

function isHelpRequest(argv: string[]) {
  return argv.length === 1 && ["help", "--help", "-h"].includes(argv[0]);
}

const KNOWN_DOCTOR_OPTIONS = [
  "--command",
  "--skip-smoke",
  "--list-orphans",
  "--reap-orphans",
  "--ensure-fff",
  "--yes",
  "--help",
] as const;

const BOOLEAN_DOCTOR_OPTIONS = new Set<string>([
  "--skip-smoke",
  "--list-orphans",
  "--reap-orphans",
  "--ensure-fff",
  "--yes",
  "--help",
]);

function unknownOptionError(option: string, argv: string[]) {
  const suggestedOption = suggestKnownOption(option);
  if (!suggestedOption) {
    return new DoctorParseError(`Unknown option: ${option}`, {
      hint: "Run help to inspect supported doctor flags.",
      suggestedCommand: "agent-session-search-doctor help",
    });
  }

  return new DoctorParseError(
    `Unknown option: ${option}; did you mean ${suggestedOption}?`,
    {
      hint: `Replace ${option} with ${suggestedOption}.`,
      suggestedCommand: correctedDoctorCommand(argv, option, suggestedOption),
    }
  );
}

function suggestKnownOption(option: string) {
  if (!option.startsWith("-")) {
    return undefined;
  }

  const normalizedOption = stripOptionPrefix(option);
  let best: { option: string; distance: number } | undefined;

  for (const knownOption of KNOWN_DOCTOR_OPTIONS) {
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

function correctedDoctorCommand(
  argv: string[],
  unknownOption: string,
  suggestedOption: string
) {
  const correctedArgs: string[] = [];
  const seenBooleanOptions = new Set<string>();
  let replaced = false;

  for (const arg of argv) {
    const correctedArg =
      !replaced && arg === unknownOption ? suggestedOption : arg;
    replaced ||= arg === unknownOption;

    if (
      BOOLEAN_DOCTOR_OPTIONS.has(correctedArg) &&
      seenBooleanOptions.has(correctedArg)
    ) {
      continue;
    }
    if (BOOLEAN_DOCTOR_OPTIONS.has(correctedArg)) {
      seenBooleanOptions.add(correctedArg);
    }
    correctedArgs.push(correctedArg);
  }

  return ["agent-session-search-doctor", ...correctedArgs]
    .map(shellQuote)
    .join(" ");
}

function stripOptionPrefix(option: string) {
  return option.replace(/^--?/, "");
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

async function runFffSmokeTest(input: FffSmokeInput): Promise<FffSmokeResult> {
  const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-fff-smoke-"));
  const root = join(tmp, "root");
  const token = "agent-session-search-doctor-smoke-token";
  let backend: OneRootFffBackend | undefined;

  try {
    await mkdir(root);
    await writeFile(join(root, "session.jsonl"), `before\n${token}\nafter\n`);
    backend = new OneRootFffBackend({
      source: "doctor" as SourceName,
      root,
      client: await createFffMcpClient(root, {
        command: input.command,
        env: input.env,
      }),
      timeoutMs: 5_000,
      emptyResultRetryAttempts: 10,
      emptyResultRetryDelayMs: 50,
    });
    const output = await backend.search({
      patterns: [token, "doctor-smoke-token"],
      maxResults: 2,
    });
    const foundToken = output.results.some((result) =>
      result.content.includes(token)
    );
    if (!foundToken) {
      return {
        ok: false,
        reason: `searched a temporary file for ${token}, but FFF returned ${output.results.length} result(s)`,
      };
    }
    const promoted = output.backend?.mode === "multi_grep";
    return {
      ok: true,
      multiGrep: promoted ? "supported" : "fallback",
      recallEquivalence: promoted ? "passed" : "failed",
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await backend?.close();
    await rm(tmp, { recursive: true, force: true });
  }
}

function printOrphans(orphans: ProcessInfo[]) {
  console.log("");
  console.log("Orphan fff-mcp cleanup:");
  console.log(`found: ${orphans.length}`);
  for (const orphan of orphans) {
    console.log(`pid ${orphan.pid}: ${orphan.command}`);
  }
}

function printReapOrphansResult(result: ReapOrphanFffMcpProcessesResult) {
  printOrphans(result.found);
  console.log(
    `reaped: ${result.reaped.length ? result.reaped.join(", ") : "none"}`
  );
  if (result.failed.length) {
    console.log(
      `failed: ${result.failed.map((failure) => `${failure.pid} (${failure.message})`).join(", ")}`
    );
  }
}

async function listProcesses(): Promise<ProcessInfo[]> {
  const stdout = process.env.AGENT_SESSION_SEARCH_DOCTOR_PS_FIXTURE;
  const output =
    stdout ??
    (await execFileAsync("ps", ["-axo", "pid=,ppid=,command="])).stdout;
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap(parseProcessLine);
}

function parseProcessLine(line: string): ProcessInfo[] {
  const match = /^(\d+)\s+(\d+)\s+(.+)$/.exec(line);
  if (!match) {
    return [];
  }
  return [
    {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3],
    },
  ];
}

async function findOnPath(command: string, path: string) {
  if (command.includes("/")) {
    return command;
  }

  for (const directory of path.split(delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = join(directory, command);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep scanning PATH entries.
    }
  }
  return undefined;
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    if (error instanceof DoctorParseError) {
      console.error(error.message);
      if (error.suggestion.hint) {
        console.error(`Hint: ${error.suggestion.hint}`);
      }
      console.error(`Suggested command: ${error.suggestion.suggestedCommand}`);
      console.error(doctorHelpText());
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = error instanceof DoctorParseError ? 1 : 4;
  });
}
