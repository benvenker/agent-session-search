#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";

const result = spawnSync("fff-mcp", ["--version"], {
  encoding: "utf8",
  stdio: "ignore",
});

if (result.error?.code === "ENOENT") {
  writeNotice("agent-session-search: fff-mcp was not found on PATH.\n");
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
