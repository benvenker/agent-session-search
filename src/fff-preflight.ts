#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
import { searchOptionsFromEnv } from "./env.js";
import {
  inspectSessionSources,
  type InspectSessionSourcesOutput,
} from "./roots.js";
import type { SourceName } from "./types.js";

const execFileAsync = promisify(execFile);

type CheckFffMcpOptions = {
  command?: string;
  env?: NodeJS.ProcessEnv;
  json?: boolean;
  skipSmoke?: boolean;
  smoke?: (input: FffSmokeInput) => Promise<FffSmokeResult>;
  nativeSmoke?: (input: NativeSmokeInput) => Promise<NativeSmokeResult>;
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
      checks: DoctorCheck[];
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
      checks: DoctorCheck[];
      recommendedAction?: string;
    };

type FffSmokeInput = {
  command: string;
  env: NodeJS.ProcessEnv;
  suppressStderr?: boolean;
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

type NativeSmokeInput = {
  command: string;
  env: NodeJS.ProcessEnv;
  serverCommand?: string;
  serverArgs?: string[];
  timeoutMs?: number;
};

type NativeSmokeResult =
  | { ok: true; tools: string[] }
  | { ok: false; reason: string };

type DoctorCheckStatus = "passed" | "failed" | "skipped" | "warning";

type DoctorCheck = {
  id:
    | "command_found"
    | "version_minimum"
    | "smoke_grep"
    | "multi_grep_available"
    | "recall_equivalence"
    | "native_server_tools";
  status: DoctorCheckStatus;
  message: string;
  recommendedAction?: string;
};

type DoctorParseSuggestion = {
  hint?: string;
  suggestedCommand: string;
};

type DoctorErrorCode =
  | "user_input_error"
  | "tool_environment_error"
  | "upstream_failure";

type DoctorOrphansDiagnostics =
  | {
      mode: "list";
      status: DoctorCheckStatus;
      found: ProcessInfo[];
      reason?: string;
    }
  | {
      mode: "reap";
      status: DoctorCheckStatus;
      found: ProcessInfo[];
      reaped: number[];
      failed: Array<{ pid: number; message: string }>;
      reason?: string;
    };

type DoctorSourceDiagnostics = Omit<InspectSessionSourcesOutput, "command">;

class DoctorParseError extends Error {
  readonly suggestion: DoctorParseSuggestion;

  constructor(message: string, suggestion: DoctorParseSuggestion) {
    super(message);
    this.name = "DoctorParseError";
    this.suggestion = suggestion;
  }
}

class DoctorDiagnosticsError extends Error {
  readonly code: Extract<
    DoctorErrorCode,
    "user_input_error" | "tool_environment_error"
  >;
  readonly exitCode: 1 | 3;

  constructor(
    code: DoctorDiagnosticsError["code"],
    message: string,
    exitCode: 1 | 3
  ) {
    super(message);
    this.name = "DoctorDiagnosticsError";
    this.code = code;
    this.exitCode = exitCode;
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
  const canEnsureFff = command === "fff-mcp";
  const dependencyFailureAction = fffDependencyFailureAction(command);

  const versionResult = await checkFffMcpVersion(command, env);
  if (!versionResult.ok) {
    const checks = failedVersionChecks(
      command,
      versionResult,
      dependencyFailureAction
    );
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
          checks,
          recommendedAction: dependencyFailureAction,
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
      canEnsureFff,
      checks,
      recommendedAction: dependencyFailureAction,
    };
  }

  try {
    const resolvedPath = await findOnPath(command, path);
    const baseChecks = [
      commandFoundCheck(command, resolvedPath),
      versionMinimumCheck(command, versionResult.version),
    ];
    let smokeResult: Extract<FffSmokeResult, { ok: true }> | undefined;
    if (!options.skipSmoke) {
      const smoke = await (options.smoke ?? runFffSmokeTest)({
        command,
        env,
        suppressStderr: options.json,
      });
      if (!smoke.ok) {
        const checks: DoctorCheck[] = [
          ...baseChecks,
          {
            id: "smoke_grep",
            status: "failed",
            message: `Live grep smoke test failed: ${smoke.reason}`,
            recommendedAction:
              "Inspect FFF MCP runtime behavior and source access; reinstalling is not expected to fix this smoke failure.",
          },
          {
            id: "multi_grep_available",
            status: "skipped",
            message:
              "multi_grep availability was not checked because the smoke grep failed.",
          },
          {
            id: "recall_equivalence",
            status: "skipped",
            message:
              "Recall equivalence was not checked because the smoke grep failed.",
          },
        ];
        return {
          ok: false,
          command,
          reason: `${command} was found, but a live grep smoke test failed: ${smoke.reason}`,
          requiredRelease: REQUIRED_FFF_MCP_RELEASE,
          recommendedRelease: RECOMMENDED_FFF_MCP_RELEASE,
          installCommand: FFF_MCP_INSTALL_COMMAND,
          path,
          canEnsureFff: false,
          checks,
        };
      }
      smokeResult = smoke;
    }

    let checks = options.skipSmoke
      ? skippedSmokeChecks(baseChecks)
      : [...baseChecks, ...smokeChecks(smokeResult!)];
    if (!options.skipSmoke && (!options.smoke || options.nativeSmoke)) {
      const nativeSmoke = await (options.nativeSmoke ?? runNativeToolsSmoke)({
        command,
        env,
      });
      if (!nativeSmoke.ok) {
        checks = [
          ...checks,
          {
            id: "native_server_tools",
            status: "failed",
            message: `Native MCP server startup/tool-listing failed: ${nativeSmoke.reason}`,
            recommendedAction:
              "Run agent-session-search-native-mcp directly with the same environment and inspect stderr.",
          },
        ];
        return {
          ok: false,
          command,
          reason: `${command} was found, but the native MCP server startup/tool-listing check failed: ${nativeSmoke.reason}`,
          requiredRelease: REQUIRED_FFF_MCP_RELEASE,
          recommendedRelease: RECOMMENDED_FFF_MCP_RELEASE,
          installCommand: FFF_MCP_INSTALL_COMMAND,
          path,
          canEnsureFff: false,
          checks,
        };
      }
      checks = [
        ...checks,
        {
          id: "native_server_tools",
          status: "passed",
          message: `Native MCP server started and listed ${nativeSmoke.tools.length} tool(s).`,
        },
      ];
    }
    return {
      ok: true,
      command,
      resolvedPath,
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
      checks,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      const reason = readVersionFailureMessage(command, error);
      return {
        ok: false,
        command,
        reason,
        requiredRelease: REQUIRED_FFF_MCP_RELEASE,
        recommendedRelease: RECOMMENDED_FFF_MCP_RELEASE,
        installCommand: FFF_MCP_INSTALL_COMMAND,
        path,
        canEnsureFff,
        checks: failedVersionChecks(
          command,
          {
            ok: false,
            reason,
            commandFound: false,
          },
          dependencyFailureAction
        ),
        recommendedAction: dependencyFailureAction,
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
      canEnsureFff,
      checks: [],
      recommendedAction: dependencyFailureAction,
    };
  }
}

async function checkFffMcpVersion(command: string, env: NodeJS.ProcessEnv) {
  try {
    const version = await readFffMcpVersion(command, env);
    const assessment = assessFffMcpVersion(version, command);
    if (!assessment.ok) {
      return { ...assessment, commandFound: true as const };
    }
    return { ok: true as const, version, commandFound: true as const };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ok: false as const,
        reason: `${command} was not found on PATH`,
        commandFound: false as const,
      };
    }
    return {
      ok: false as const,
      reason: readVersionFailureMessage(command, error),
      commandFound: true as const,
    };
  }
}

function failedVersionChecks(
  command: string,
  versionResult: {
    ok: false;
    reason: string;
    version?: string;
    commandFound?: boolean;
  },
  recommendedAction = fffDependencyFailureAction(command)
): DoctorCheck[] {
  if (versionResult.commandFound === false) {
    return [
      {
        id: "command_found",
        status: "failed",
        message: `${command} was not found on PATH.`,
        recommendedAction,
      },
      {
        id: "version_minimum",
        status: "skipped",
        message:
          "Version minimum was not checked because the command was not found.",
      },
      {
        id: "smoke_grep",
        status: "skipped",
        message: "Smoke grep was not run because the command was not found.",
      },
      {
        id: "multi_grep_available",
        status: "skipped",
        message:
          "multi_grep availability was not checked because the command was not found.",
      },
      {
        id: "recall_equivalence",
        status: "skipped",
        message:
          "Recall equivalence was not checked because the command was not found.",
      },
    ];
  }

  return [
    {
      id: "command_found",
      status: "passed",
      message: `${command} was found.`,
    },
    {
      id: "version_minimum",
      status: "failed",
      message: versionResult.reason,
      recommendedAction,
    },
    {
      id: "smoke_grep",
      status: "skipped",
      message: "Smoke grep was not run because the version check failed.",
    },
    {
      id: "multi_grep_available",
      status: "skipped",
      message:
        "multi_grep availability was not checked because the version check failed.",
    },
    {
      id: "recall_equivalence",
      status: "skipped",
      message:
        "Recall equivalence was not checked because the version check failed.",
    },
  ];
}

function fffDependencyFailureAction(command: string) {
  return command === "fff-mcp"
    ? "Install or upgrade FFF MCP with the official installer."
    : "Upgrade or fix the custom FFF MCP binary; the built-in installer only manages PATH fff-mcp.";
}

function commandFoundCheck(command: string, resolvedPath: string | undefined) {
  return {
    id: "command_found",
    status: "passed",
    message: resolvedPath
      ? `${command} was found at ${resolvedPath}.`
      : `${command} was found.`,
  } satisfies DoctorCheck;
}

function versionMinimumCheck(command: string, version: string) {
  return {
    id: "version_minimum",
    status: "passed",
    message: `${command} version output "${version}" satisfies required minimum ${REQUIRED_FFF_MCP_RELEASE}.`,
  } satisfies DoctorCheck;
}

function skippedSmokeChecks(baseChecks: DoctorCheck[]) {
  return [
    ...baseChecks,
    {
      id: "smoke_grep",
      status: "skipped",
      message: "Smoke grep was skipped by --skip-smoke.",
    },
    {
      id: "multi_grep_available",
      status: "skipped",
      message: "multi_grep availability was skipped by --skip-smoke.",
    },
    {
      id: "recall_equivalence",
      status: "skipped",
      message: "Recall equivalence was skipped by --skip-smoke.",
    },
  ] satisfies DoctorCheck[];
}

function smokeChecks(smokeResult: Extract<FffSmokeResult, { ok: true }>) {
  return [
    {
      id: "smoke_grep",
      status: "passed",
      message: "Live grep smoke test passed.",
    },
    {
      id: "multi_grep_available",
      status: smokeResult.multiGrep === "supported" ? "passed" : "warning",
      message:
        smokeResult.multiGrep === "supported"
          ? "multi_grep is available."
          : "multi_grep is unavailable; sequential fallback remains healthy.",
      ...(smokeResult.multiGrep === "supported"
        ? {}
        : {
            recommendedAction:
              "Upgrade FFF MCP when convenient to enable multi_grep acceleration.",
          }),
    },
    {
      id: "recall_equivalence",
      status: smokeResult.recallEquivalence === "passed" ? "passed" : "warning",
      message:
        smokeResult.recallEquivalence === "passed"
          ? "multi_grep recall matched sequential fallback."
          : "Recall equivalence was not proven because sequential fallback was used.",
    },
  ] satisfies DoctorCheck[];
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
  const orphans = options.json
    ? await collectOrphanDiagnostics(options)
    : undefined;
  let sourceDiagnostics: DoctorSourceDiagnostics | undefined;
  if (options.json) {
    try {
      sourceDiagnostics = await collectSourceDiagnostics(
        options.env ?? process.env
      );
    } catch (error) {
      console.error(
        JSON.stringify(doctorDiagnosticsErrorEnvelope(error, orphans), null, 2)
      );
      process.exitCode =
        error instanceof DoctorDiagnosticsError ? error.exitCode : 4;
      return;
    }
  }
  const result = await checkFffMcp(options);

  if (result.ok) {
    if (options.json) {
      if (orphans?.status === "failed") {
        console.error(
          JSON.stringify(
            doctorOrphanErrorEnvelope(orphans, sourceDiagnostics),
            null,
            2
          )
        );
        process.exitCode = 4;
        return;
      }
      console.log(
        JSON.stringify(
          doctorSuccessEnvelope(result, orphans, sourceDiagnostics),
          null,
          2
        )
      );
      return;
    }
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

  if (options.json) {
    console.error(
      JSON.stringify(
        doctorFffErrorEnvelope(result, orphans, sourceDiagnostics),
        null,
        2
      )
    );
    process.exitCode = 3;
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
  } else if (result.recommendedAction) {
    console.error(`Recommended action: ${result.recommendedAction}`);
  }
  console.error("Review the installer before running it if desired:");
  console.error(`  ${FFF_MCP_INSTALLER_URL}`);
  process.exitCode = 3;
}

async function collectOrphanDiagnostics(
  options: CheckFffMcpOptions
): Promise<DoctorOrphansDiagnostics | null> {
  if (options.reapOrphans) {
    try {
      const result = await reapOrphanFffMcpProcesses();
      return {
        mode: "reap",
        status: result.failed.length ? "failed" : "passed",
        found: result.found,
        reaped: result.reaped,
        failed: result.failed,
      };
    } catch (error) {
      return {
        mode: "reap",
        status: "failed",
        found: [],
        reaped: [],
        failed: [],
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (options.listOrphans) {
    try {
      return {
        mode: "list",
        status: "passed",
        found: await findOrphanFffMcpProcesses(),
      };
    } catch (error) {
      return {
        mode: "list",
        status: "failed",
        found: [],
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return null;
}

async function collectSourceDiagnostics(
  env: NodeJS.ProcessEnv
): Promise<DoctorSourceDiagnostics> {
  const configPath = searchOptionsFromEnv(env).configPath;

  try {
    const { command: _command, ...diagnostics } = await inspectSessionSources({
      configPath,
    });
    return diagnostics;
  } catch (error) {
    const pathForMessage = configPath ?? "default config path";
    if (error instanceof SyntaxError) {
      throw new DoctorDiagnosticsError(
        "user_input_error",
        `Config JSON is invalid at ${pathForMessage}: ${error.message}`,
        1
      );
    }
    throw new DoctorDiagnosticsError(
      "tool_environment_error",
      `Config could not be read at ${pathForMessage}: ${errorMessage(error)}`,
      3
    );
  }
}

function doctorSuccessEnvelope(
  result: Extract<CheckFffMcpResult, { ok: true }>,
  orphans: DoctorOrphansDiagnostics | null = null,
  sourceDiagnostics: DoctorSourceDiagnostics | null = null
) {
  return {
    tool: "agent-session-search-doctor",
    contractVersion: "1.0",
    ok: true,
    command: result.command,
    ...(result.resolvedPath ? { resolvedPath: result.resolvedPath } : {}),
    version: result.version,
    requiredRelease: result.requiredRelease,
    recommendedRelease: result.recommendedRelease,
    installCommand: result.installCommand,
    checks: result.checks,
    sourceDiagnostics,
    orphans,
  };
}

function doctorFffErrorEnvelope(
  result: Extract<CheckFffMcpResult, { ok: false }>,
  orphans: DoctorOrphansDiagnostics | null = null,
  sourceDiagnostics: DoctorSourceDiagnostics | null = null
) {
  return doctorErrorEnvelope({
    code: "tool_environment_error",
    message: result.reason,
    exitCode: 3,
    canEnsureFff: result.canEnsureFff,
    recommendedAction: result.recommendedAction,
    suggestedCommand: result.canEnsureFff
      ? "agent-session-search-doctor --ensure-fff --yes"
      : undefined,
    requiredRelease: result.requiredRelease,
    recommendedRelease: result.recommendedRelease,
    installCommand: result.installCommand,
    checks: result.checks,
    orphans,
    sourceDiagnostics,
  });
}

function doctorOrphanErrorEnvelope(
  orphans: DoctorOrphansDiagnostics,
  sourceDiagnostics: DoctorSourceDiagnostics | null = null
) {
  return doctorErrorEnvelope({
    code: "upstream_failure",
    message:
      orphans.reason ??
      (orphans.mode === "reap"
        ? "One or more orphan fff-mcp processes could not be reaped"
        : "Failed to list orphan fff-mcp processes"),
    exitCode: 4,
    orphans,
    sourceDiagnostics,
  });
}

function doctorDiagnosticsErrorEnvelope(
  error: unknown,
  orphans: DoctorOrphansDiagnostics | null = null
) {
  if (error instanceof DoctorDiagnosticsError) {
    return doctorErrorEnvelope({
      code: error.code,
      message: error.message,
      exitCode: error.exitCode,
      orphans,
    });
  }
  return doctorErrorEnvelope({
    code: "upstream_failure",
    message: errorMessage(error),
    exitCode: 4,
    orphans,
  });
}

function doctorParseErrorEnvelope(error: DoctorParseError) {
  return doctorErrorEnvelope({
    code: "user_input_error",
    message: error.message,
    exitCode: 1,
    hint: error.suggestion.hint,
    suggestedCommand: error.suggestion.suggestedCommand,
  });
}

function doctorUpstreamErrorEnvelope(error: unknown) {
  return doctorErrorEnvelope({
    code: "upstream_failure",
    message: error instanceof Error ? error.message : String(error),
    exitCode: 4,
  });
}

function doctorErrorEnvelope({
  code,
  message,
  exitCode,
  hint,
  suggestedCommand,
  canEnsureFff,
  recommendedAction,
  requiredRelease,
  recommendedRelease,
  installCommand,
  checks = [],
  sourceDiagnostics = null,
  orphans = null,
}: {
  code: DoctorErrorCode;
  message: string;
  exitCode: 1 | 3 | 4;
  hint?: string;
  suggestedCommand?: string;
  canEnsureFff?: boolean;
  recommendedAction?: string;
  requiredRelease?: string;
  recommendedRelease?: string;
  installCommand?: string;
  checks?: DoctorCheck[];
  sourceDiagnostics?: DoctorSourceDiagnostics | null;
  orphans?: DoctorOrphansDiagnostics | null;
}) {
  return {
    tool: "agent-session-search-doctor",
    contractVersion: "1.0",
    ok: false,
    error: {
      code,
      message,
      ...(hint ? { hint } : {}),
      ...(suggestedCommand ? { suggestedCommand } : {}),
      ...(canEnsureFff === undefined ? {} : { canEnsureFff }),
      ...(recommendedAction ? { recommendedAction } : {}),
    },
    ...(requiredRelease ? { requiredRelease } : {}),
    ...(recommendedRelease ? { recommendedRelease } : {}),
    ...(installCommand ? { installCommand } : {}),
    checks,
    sourceDiagnostics,
    orphans,
    exitCode,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(argv: string[]): CheckFffMcpOptions {
  const options: CheckFffMcpOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--command") {
      const command = argv[index + 1];
      if (!command || isDoctorOption(command)) {
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
  if (options.listOrphans && options.reapOrphans) {
    throw new DoctorParseError(
      "--list-orphans and --reap-orphans cannot be used together",
      {
        hint: "Choose --list-orphans for a read-only diagnostic, or --reap-orphans for explicit process cleanup.",
        suggestedCommand: "agent-session-search-doctor --list-orphans",
      }
    );
  }
  return options;
}

function isHelpRequest(argv: string[]) {
  return argv.length === 1 && ["help", "--help", "-h"].includes(argv[0]);
}

const KNOWN_DOCTOR_OPTIONS = [
  "--json",
  "--command",
  "--skip-smoke",
  "--list-orphans",
  "--reap-orphans",
  "--ensure-fff",
  "--yes",
  "--help",
] as const;

const BOOLEAN_DOCTOR_OPTIONS = new Set<string>([
  "--json",
  "--skip-smoke",
  "--list-orphans",
  "--reap-orphans",
  "--ensure-fff",
  "--yes",
  "--help",
]);

function isDoctorOption(value: string) {
  return KNOWN_DOCTOR_OPTIONS.includes(
    value as (typeof KNOWN_DOCTOR_OPTIONS)[number]
  );
}

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
        stderr: input.suppressStderr ? "pipe" : undefined,
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

export async function runNativeToolsSmoke(
  input: NativeSmokeInput
): Promise<NativeSmokeResult> {
  const env = {
    ...stringEnv(input.env),
    AGENT_SESSION_SEARCH_FFF_MCP_COMMAND: input.command,
  };
  const transport = new StdioClientTransport({
    command: input.serverCommand ?? process.execPath,
    args: input.serverArgs ?? nativeServerNodeArgs(),
    env,
    stderr: "pipe",
  });
  const client = new Client({
    name: "agent-session-search-doctor-native-smoke",
    version: "0.1.0",
  });

  try {
    const result = await withTimeout(
      async () => {
        await client.connect(transport);
        return client.listTools();
      },
      input.timeoutMs ?? 5_000,
      "native_server_tools_timeout"
    );
    const tools = result.tools.map((tool) => tool.name);
    if (!tools.includes("fff_native_capabilities")) {
      return {
        ok: false,
        reason: "tools/list did not include fff_native_capabilities",
      };
    }
    return { ok: true, tools };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function nativeServerNodeArgs() {
  const current = fileURLToPath(import.meta.url);
  if (current.endsWith(".ts")) {
    return ["--import", "tsx", join(process.cwd(), "src", "native-server.ts")];
  }
  return [fileURLToPath(new URL("./native-server.js", import.meta.url))];
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
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

export function handleDoctorEntrypointError(
  error: unknown,
  argv = process.argv.slice(2)
) {
  if (argv.includes("--json")) {
    console.error(
      JSON.stringify(
        error instanceof DoctorParseError
          ? doctorParseErrorEnvelope(error)
          : doctorUpstreamErrorEnvelope(error),
        null,
        2
      )
    );
    process.exitCode = error instanceof DoctorParseError ? 1 : 4;
    return;
  }
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
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    handleDoctorEntrypointError(error);
  });
}
