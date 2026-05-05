import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import {
  getTrackedChildProcessPids,
  killTrackedChildProcesses,
  trackChildProcessPid,
} from "../src/child-process-cleanup.js";

describe("child process cleanup", () => {
  it("kills tracked process groups, including same-group descendants", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        [
          'const { spawn } = require("node:child_process");',
          'const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
          "console.log(grandchild.pid);",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      ],
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    expect(child.pid).toBeTypeOf("number");
    const childPid = child.pid!;
    const grandchildPid = await readFirstStdoutLineAsNumber(child);

    trackChildProcessPid(childPid, { processGroup: true });
    killTrackedChildProcesses("SIGKILL");

    await waitForProcessToExit(childPid);
    await waitForProcessToExit(grandchildPid);
    expect(getTrackedChildProcessPids()).not.toContain(childPid);
  });

  it("tracks child pids, untracks them, and force-kills remaining tracked children", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        stdio: "ignore",
      }
    );
    expect(child.pid).toBeTypeOf("number");
    const pid = child.pid!;

    const untrack = trackChildProcessPid(pid);
    expect(getTrackedChildProcessPids()).toContain(pid);

    untrack();
    expect(getTrackedChildProcessPids()).not.toContain(pid);

    trackChildProcessPid(pid);
    const exit = once(child, "exit");
    killTrackedChildProcesses("SIGKILL");

    await exit;
    expect(getTrackedChildProcessPids()).not.toContain(pid);
  });

  it("kills tracked children when the MCP server stdin closes", async () => {
    const script = `
      import { spawn } from "node:child_process";
      import { installProcessCleanupHandlers } from "./src/server.ts";
      import { trackChildProcessPid } from "./src/child-process-cleanup.ts";

      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      if (!child.pid) throw new Error("missing child pid");
      trackChildProcessPid(child.pid);
      console.log(child.pid);
      installProcessCleanupHandlers();
      setInterval(() => {}, 1000);
    `;
    const server = spawn(
      process.execPath,
      ["node_modules/.bin/tsx", "--eval", script],
      {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    const childPid = await readFirstStdoutLineAsNumber(server);

    server.stdin.end();
    const [code, signal] = (await once(server, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];

    try {
      await waitForProcessToExit(childPid);
      expect({ code, signal }).toEqual({ code: 0, signal: null });
    } finally {
      killPidIfAlive(childPid);
      killPidIfAlive(server.pid);
    }
  });
});

async function readFirstStdoutLineAsNumber(
  child: ReturnType<typeof spawn>
): Promise<number> {
  let buffer = "";
  for await (const chunk of child.stdout!) {
    buffer += chunk.toString("utf8");
    const line = buffer.split(/\r?\n/).find((candidate) => candidate.trim());
    if (line) {
      const pid = Number(line.trim());
      if (!Number.isInteger(pid)) {
        throw new Error(`Expected pid on stdout, got: ${line}`);
      }
      return pid;
    }
  }
  const stderr = await streamText(child.stderr);
  throw new Error(
    `Process exited before printing child pid. stderr: ${stderr}`
  );
}

async function waitForProcessToExit(pid: number) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!isPidAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected pid ${pid} to exit`);
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPidIfAlive(pid: number | undefined) {
  if (!pid) {
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

async function streamText(stream: NodeJS.ReadableStream | null) {
  if (!stream) {
    return "";
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
