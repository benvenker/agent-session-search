#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync, writeSync } from "node:fs";

const FFF_MCP_INSTALLER_URL = "https://dmtrkovalenko.dev/install-fff-mcp.sh";
const FFF_MCP_INSTALL_COMMAND = `curl -L ${FFF_MCP_INSTALLER_URL} | bash`;

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
        "Install FFF now with this command?",
        `  ${FFF_MCP_INSTALL_COMMAND}`,
        "",
        "Press Enter to run it, or Ctrl-C to skip.",
        "",
      ].join("\n")
    );
    readUntilEnter(tty);
  } finally {
    closeSync(tty);
  }

  const install = spawnSync(
    "bash",
    ["-c", `set -euo pipefail; ${FFF_MCP_INSTALL_COMMAND}`],
    {
      stdio: "inherit",
    }
  );

  if (install.status === 0) {
    writeNotice("\nFFF installed. Verify with: agent-session-search-doctor\n");
    return;
  }

  const code =
    install.status === null
      ? `signal ${install.signal}`
      : `exit ${install.status}`;
  writeNotice(
    [
      "",
      `FFF install failed (${code}).`,
      `You can retry manually with: ${FFF_MCP_INSTALL_COMMAND}`,
      "",
    ].join("\n")
  );
  process.exitCode = install.status ?? 1;
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

function readUntilEnter(tty) {
  const buffer = Buffer.alloc(1);
  while (true) {
    const bytesRead = readSync(tty, buffer, 0, 1, null);
    if (bytesRead === 0 || buffer[0] === 10 || buffer[0] === 13) {
      return;
    }
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
