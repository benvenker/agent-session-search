import { spawn, type ChildProcess } from "node:child_process";
import { PassThrough, type Stream } from "node:stream";
import {
  DEFAULT_INHERITED_ENV_VARS,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ReadBuffer,
  serializeMessage,
} from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export class DetachedStdioClientTransport implements Transport {
  private process?: ChildProcess;
  private readonly readBuffer = new ReadBuffer();
  private readonly stderrStream: PassThrough | null = null;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private readonly server: StdioServerParameters) {
    if (server.stderr === "pipe" || server.stderr === "overlapped") {
      this.stderrStream = new PassThrough();
    }
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error("DetachedStdioClientTransport already started.");
    }

    await new Promise<void>((resolve, reject) => {
      const childProcess = spawn(this.server.command, this.server.args ?? [], {
        env: {
          ...getDefaultEnvironment(),
          ...this.server.env,
        },
        stdio: ["pipe", "pipe", this.server.stderr ?? "inherit"],
        shell: false,
        windowsHide: process.platform === "win32",
        cwd: this.server.cwd,
        detached: process.platform !== "win32",
      });

      this.process = childProcess;
      childProcess.on("error", (error) => {
        reject(error);
        this.onerror?.(error);
      });
      childProcess.on("spawn", () => resolve());
      childProcess.on("close", () => {
        this.process = undefined;
        this.onclose?.();
      });
      childProcess.stdin?.on("error", (error) => {
        this.onerror?.(error);
      });
      childProcess.stdout?.on("data", (chunk) => {
        this.readBuffer.append(chunk);
        this.processReadBuffer();
      });
      childProcess.stdout?.on("error", (error) => {
        this.onerror?.(error);
      });
      if (this.stderrStream && childProcess.stderr) {
        childProcess.stderr.pipe(this.stderrStream);
      }
    });
  }

  get stderr(): Stream | null {
    if (this.stderrStream) {
      return this.stderrStream;
    }
    return this.process?.stderr ?? null;
  }

  get pid(): number | null {
    return this.process?.pid ?? null;
  }

  async close(): Promise<void> {
    if (this.process) {
      const processToClose = this.process;
      this.process = undefined;
      const closePromise = new Promise<void>((resolve) => {
        processToClose.once("close", () => resolve());
      });
      try {
        processToClose.stdin?.end();
      } catch {
        // ignore
      }
      await Promise.race([closePromise, delay(2_000)]);
      if (processToClose.exitCode === null) {
        killProcessGroupOrPid(processToClose.pid, "SIGTERM");
        await Promise.race([closePromise, delay(2_000)]);
      }
      if (processToClose.exitCode === null) {
        killProcessGroupOrPid(processToClose.pid, "SIGKILL");
      }
    }
    this.readBuffer.clear();
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      const stdin = this.process?.stdin;
      if (!stdin) {
        throw new Error("Not connected");
      }
      const json = serializeMessage(message);
      if (stdin.write(json)) {
        resolve();
      } else {
        stdin.once("drain", resolve);
      }
    });
  }

  private processReadBuffer() {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (message === null) {
          break;
        }
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error as Error);
      }
    }
  }
}

function getDefaultEnvironment() {
  const env: Record<string, string> = {};
  for (const key of DEFAULT_INHERITED_ENV_VARS) {
    const value = process.env[key];
    if (value === undefined || value.startsWith("()")) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

function killProcessGroupOrPid(
  pid: number | undefined,
  signal: NodeJS.Signals
) {
  if (!pid) {
    return;
  }
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
  } catch {
    // ignore
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms).unref());
}

export type { StdioServerParameters };
