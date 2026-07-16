#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";

const FFF_MCP_INSTALLER_URL =
  "https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh";
const FFF_MCP_INSTALL_COMMAND = `curl -fsSL ${FFF_MCP_INSTALLER_URL} | bash`;
const RECOMMENDED_FFF_MCP_RELEASE = "v0.9.6";

const result = spawnSync("fff-mcp", ["--version"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.error?.code === "ENOENT") {
  promptToInstallFffMcp("it's not installed");
} else if (result.status === 0 && !isCompatibleVersion(result)) {
  promptToInstallFffMcp("the installed version is below v0.9.6");
}

function promptToInstallFffMcp(reason) {
  const tty = openTty();

  if (!tty) {
    writeNotice(
      [
        `agent-session-search uses fff-mcp for fast file searching, but ${reason}.`,
        "",
        `Recommended stable FFF MCP: ${RECOMMENDED_FFF_MCP_RELEASE}`,
        `Install FFF with: ${FFF_MCP_INSTALL_COMMAND}`,
        "Then verify with: agent-session-search-doctor",
        "",
      ].join("\n")
    );
    return;
  }

  try {
    writeSync(
      tty,
      [
        `agent-session-search uses fff-mcp for fast file searching, but ${reason}.`,
        "",
        `Recommended stable FFF MCP: ${RECOMMENDED_FFF_MCP_RELEASE}`,
        "Install FFF manually with:",
        `  ${FFF_MCP_INSTALL_COMMAND}`,
        "",
        "Then verify with: agent-session-search-doctor",
        "",
      ].join("\n")
    );
  } finally {
    closeSync(tty);
  }
}

function isCompatibleVersion(result) {
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const match = /^fff-mcp\s+v?(\d+)\.(\d+)\.(\d+)/.exec(output);
  if (!match) {
    return false;
  }

  const installed = [Number(match[1]), Number(match[2]), Number(match[3])];
  const required = [0, 9, 6];
  for (let index = 0; index < required.length; index += 1) {
    const delta = installed[index] - required[index];
    if (delta !== 0) {
      return delta > 0;
    }
  }
  return true;
}

function openTty() {
  if (process.env.CI) {
    return undefined;
  }

  try {
    return openSync("/dev/tty", "r+");
  } catch {
    return undefined;
  }
}

function writeNotice(message) {
  if (process.env.CI) {
    process.stderr.write(message);
    return;
  }

  try {
    const tty = openSync("/dev/tty", "w");
    try {
      writeSync(tty, message);
    } finally {
      closeSync(tty);
    }
  } catch {
    process.stderr.write(message);
  }
}
