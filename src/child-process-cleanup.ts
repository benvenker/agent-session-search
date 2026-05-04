const trackedChildProcessPids = new Set<number>();

export function trackChildProcessPid(pid: number): () => void {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid child process pid: ${pid}`);
  }

  trackedChildProcessPids.add(pid);
  let tracked = true;

  return () => {
    if (!tracked) {
      return;
    }
    tracked = false;
    trackedChildProcessPids.delete(pid);
  };
}

export function killTrackedChildProcesses(
  signal: NodeJS.Signals = "SIGKILL"
): void {
  for (const pid of Array.from(trackedChildProcessPids)) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (!isNoSuchProcessError(error)) {
        // Shutdown cleanup must be best-effort. A child that cannot be signaled
        // should not prevent the MCP server itself from exiting.
      }
    } finally {
      trackedChildProcessPids.delete(pid);
    }
  }
}

export function getTrackedChildProcessPids(): number[] {
  return Array.from(trackedChildProcessPids);
}

function isNoSuchProcessError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ESRCH"
  );
}
