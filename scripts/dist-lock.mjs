import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_DIST_LOCK_TIMEOUT_MS = 120_000;
const STALE_LOCK_MS = 30_000;

export async function defaultDistLockDir(cwd) {
  return join(
    tmpdir(),
    `agent-session-search-dist-${createHash("sha256")
      .update(await realpath(cwd))
      .digest("hex")
      .slice(0, 16)}.lock`
  );
}

export function parseDistLockTimeoutMs(raw) {
  if (raw === undefined) {
    return DEFAULT_DIST_LOCK_TIMEOUT_MS;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(
      "AGENT_SESSION_SEARCH_DIST_LOCK_TIMEOUT_MS must be a finite positive integer"
    );
  }
  const timeoutMs = Number(raw);
  if (!Number.isSafeInteger(timeoutMs)) {
    throw new Error(
      "AGENT_SESSION_SEARCH_DIST_LOCK_TIMEOUT_MS must be a finite positive integer"
    );
  }
  return timeoutMs;
}

export async function acquireDistLock({ cwd, lockDir, timeoutMs }) {
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(lockDir);
      await writeFile(
        join(lockDir, "owner.json"),
        JSON.stringify({
          pid: process.pid,
          cwd,
          startedAt: new Date().toISOString(),
        })
      );
      return async () => {
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await reclaimStaleLock(lockDir)) {
        continue;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for dist build lock: ${lockDir}`);
      }
      await sleep(100);
    }
  }
}

async function reclaimStaleLock(lockDir) {
  const owner = await readLockOwner(lockDir);
  if (owner?.pid && processExists(owner.pid)) {
    return false;
  }

  const stats = await stat(lockDir).catch(() => undefined);
  if (!stats || Date.now() - stats.mtimeMs < STALE_LOCK_MS) {
    return false;
  }

  const tombstone = `${lockDir}.stale-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    await rename(lockDir, tombstone);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST") {
      return true;
    }
    throw error;
  }
  await rm(tombstone, { recursive: true, force: true });
  return true;
}

async function readLockOwner(lockDir) {
  const raw = await readFile(join(lockDir, "owner.json"), "utf8").catch(
    () => undefined
  );
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
