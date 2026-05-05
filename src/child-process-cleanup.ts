type TrackedChildProcess = {
  pid: number;
  processGroup: boolean;
};

const trackedChildProcesses = new Map<number, TrackedChildProcess>();

export type TrackChildProcessOptions = {
  processGroup?: boolean;
};

export function trackChildProcessPid(
  pid: number,
  options: TrackChildProcessOptions = {}
): () => void {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid child process pid: ${pid}`);
  }

  trackedChildProcesses.set(pid, {
    pid,
    processGroup: options.processGroup ?? false,
  });
  let tracked = true;

  return () => {
    if (!tracked) {
      return;
    }
    tracked = false;
    trackedChildProcesses.delete(pid);
  };
}

export function killTrackedChildProcesses(
  signal: NodeJS.Signals = "SIGKILL"
): void {
  for (const child of Array.from(trackedChildProcesses.values())) {
    try {
      process.kill(child.processGroup ? -child.pid : child.pid, signal);
    } catch (error) {
      if (!isNoSuchProcessError(error)) {
        // Shutdown cleanup must be best-effort. A child that cannot be signaled
        // should not prevent the MCP server itself from exiting.
      }
    } finally {
      trackedChildProcesses.delete(child.pid);
    }
  }
}

export function getTrackedChildProcessPids(): number[] {
  return Array.from(trackedChildProcesses.keys());
}

function isNoSuchProcessError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ESRCH"
  );
}
