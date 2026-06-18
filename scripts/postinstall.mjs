#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";

const FFF_MCP_INSTALLER_URL =
  "https://raw.githubusercontent.com/dmtrKovalenko/fff.nvim/main/install-mcp.sh";
const FFF_MCP_INSTALL_COMMAND = `curl -fsSL ${FFF_MCP_INSTALLER_URL} | bash`;
const RECOMMENDED_FFF_MCP_RELEASE = "v0.9.5";

const result = spawnSync("fff-mcp", ["--version"], {
  encoding: "utf8",
  stdio: "ignore",
});

if (result.error?.code === "ENOENT") {
  promptToInstallFffMcp();
}

function promptToInstallFffMcp() {
  const tty = openTty();

  if (!tty) {
    writeNotice(
      [
        "agent-session-search uses fff-mcp for fast file searching, but it's not installed.",
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
        "agent-session-search uses fff-mcp for fast file searching, but it's not installed.",
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
