import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const compatibilityChecks = new Map<string, Promise<void>>();
const FFF_MCP_VERSION_TIMEOUT_MS = 5_000;

export const FFF_MCP_INSTALLER_URL =
  "https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh";
export const REQUIRED_FFF_MCP_RELEASE = "v0.9.6";
export const RECOMMENDED_FFF_MCP_RELEASE = REQUIRED_FFF_MCP_RELEASE;
export const FFF_MCP_INSTALL_COMMAND = `curl -fsSL ${FFF_MCP_INSTALLER_URL} | bash`;

export type FffMcpVersionAssessment =
  | {
      ok: true;
      version: string;
    }
  | {
      ok: false;
      version?: string;
      reason: string;
    };

export type FffMcpVersionGuidance =
  | {
      ok: true;
      version: string;
      status: "current" | "older_than_recommended" | "unknown";
      recommendedAction?: string;
    }
  | {
      ok: false;
      version?: string;
      reason: string;
    };

export class FffMcpCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FffMcpCompatibilityError";
  }
}

export async function readFffMcpVersion(
  command: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const { stdout, stderr } = await execFileAsync(command, ["--version"], {
    env,
    timeout: FFF_MCP_VERSION_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return `${stdout}${stderr}`.trim();
}

export function assessFffMcpVersion(
  versionOutput: string,
  command = "fff-mcp"
): FffMcpVersionAssessment {
  const installed = parseVersion(versionOutput);

  if (!installed) {
    return {
      ok: false,
      reason: `${command} version could not be determined from --version output; recommended stable release is ${RECOMMENDED_FFF_MCP_RELEASE}`,
    };
  }

  return { ok: true, version: formatVersion(installed) };
}

export function assessFffMcpVersionGuidance(
  versionOutput: string,
  command = "fff-mcp"
): FffMcpVersionGuidance {
  const installed = parseVersion(versionOutput);
  const recommended = parseVersion(RECOMMENDED_FFF_MCP_RELEASE);

  if (!installed) {
    return {
      ok: true,
      version: versionOutput.trim() || "unknown",
      status: "unknown",
      recommendedAction: `Verify FFF MCP with agent-session-search-doctor --json; upgrade manually if capability checks fail: ${FFF_MCP_INSTALL_COMMAND}`,
    };
  }

  const version = formatVersion(installed);
  if (recommended && compareVersions(installed, recommended) < 0) {
    return {
      ok: true,
      version,
      status: "older_than_recommended",
      recommendedAction: `Upgrade FFF MCP when convenient with: ${FFF_MCP_INSTALL_COMMAND}`,
    };
  }

  return {
    ok: true,
    version,
    status: "current",
  };
}

export async function ensureFffMcpCompatible(
  command = "fff-mcp",
  env: NodeJS.ProcessEnv = process.env
) {
  const cacheKey = `${command}\0${env.PATH ?? ""}`;
  let check = compatibilityChecks.get(cacheKey);
  if (!check) {
    check = checkFffMcpCompatible(command, env).catch((error: unknown) => {
      compatibilityChecks.delete(cacheKey);
      throw error;
    });
    compatibilityChecks.set(cacheKey, check);
  }
  await check;
}

async function checkFffMcpCompatible(command: string, env: NodeJS.ProcessEnv) {
  let versionOutput: string;
  try {
    versionOutput = await readFffMcpVersion(command, env);
  } catch (error) {
    throw new FffMcpCompatibilityError(
      readVersionFailureMessage(command, error)
    );
  }

  const assessment = assessFffMcpVersion(versionOutput, command);
  if (!assessment.ok) {
    return;
  }
}

export function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function readVersionFailureMessage(command: string, error: unknown) {
  if (isNotFoundError(error)) {
    return `${command} was not found on PATH. Install or upgrade FFF MCP with: ${FFF_MCP_INSTALL_COMMAND}`;
  }
  return `${command} --version failed: ${
    error instanceof Error ? error.message : String(error)
  }. Install or upgrade FFF MCP with: ${FFF_MCP_INSTALL_COMMAND}`;
}

function parseVersion(value: string) {
  const trimmed = value.trim();
  const match =
    /^fff-mcp\s+v?(\d+)\.(\d+)\.(\d+)/.exec(trimmed) ??
    /^v?(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

function compareVersions(
  left: readonly [number, number, number],
  right: readonly [number, number, number]
) {
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index]! - right[index]!;
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function formatVersion(version: readonly [number, number, number]) {
  return version.join(".");
}
