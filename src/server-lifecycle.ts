import { killTrackedChildProcesses } from "./child-process-cleanup.js";

export type ServerLifecycle = {
  shutdown(exitCode?: number): Promise<void>;
};

export function installProcessCleanupHandlers(
  cleanup?: () => Promise<void> | void
): ServerLifecycle {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  let exiting = false;

  const shutdown = async (exitCode = 0) => {
    if (exiting) {
      return;
    }
    exiting = true;
    let cleanupError: unknown;
    try {
      await runCleanup(cleanup);
    } catch (error) {
      cleanupError = error;
    } finally {
      killTrackedChildProcesses("SIGKILL");
    }
    if (cleanupError) {
      throw cleanupError;
    }
    process.exit(exitCode);
  };

  for (const signal of signals) {
    process.once(signal, () => {
      void shutdown(signal === "SIGINT" ? 130 : 143).catch((error) => {
        reportCleanupError(error);
        process.exit(1);
      });
    });
  }

  process.once("exit", () => {
    void runCleanup(cleanup).catch(reportCleanupError);
    killTrackedChildProcesses("SIGKILL");
  });

  process.stdin.once("readable", () => {
    // Keep stdin in paused mode for MCP transports, but make Node observe EOF
    // so a client closing its stdio pipe terminates the server promptly.
  });
  process.stdin.once("end", () => {
    void shutdown(0).catch((error) => {
      reportCleanupError(error);
      process.exit(1);
    });
  });
  process.stdin.once("close", () => {
    void shutdown(0).catch((error) => {
      reportCleanupError(error);
      process.exit(1);
    });
  });

  return { shutdown };
}

async function runCleanup(cleanup: (() => Promise<void> | void) | undefined) {
  if (!cleanup) {
    return;
  }
  const cleanupPromise = Promise.resolve().then(cleanup);
  const timeout = new Promise<"timeout">((resolve) =>
    setTimeout(resolve, 2_000, "timeout").unref()
  );
  const result = await Promise.race([
    cleanupPromise.then(
      () => undefined,
      (error) => error
    ),
    timeout,
  ]);
  cleanupPromise.catch(() => undefined);
  if (result === undefined) {
    return;
  }
  if (result === "timeout") {
    throw new AggregateError(
      [new Error("Shutdown cleanup timed out after 2000ms")],
      "Shutdown cleanup failed"
    );
  }
  throw new AggregateError([result], "Shutdown cleanup failed");
}

function reportCleanupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
}
