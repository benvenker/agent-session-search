import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  acquireDistLock,
  defaultDistLockDir,
  parseDistLockTimeoutMs,
} from "./dist-lock.mjs";

const execFileAsync = promisify(execFile);

// Several suites spawn binaries out of dist/ while others rebuild it, and
// `npm run build` deletes dist/ before recreating it. Building once here, and
// holding a cross-process lock for the whole run, keeps dist/ stable while any
// test reads it — both within a run and across concurrent `npm test` runs.
export default async function setup() {
  const cwd = process.cwd();
  const release = await acquireDistLock({
    cwd,
    lockDir: await defaultDistLockDir(cwd),
    timeoutMs: parseDistLockTimeoutMs(
      process.env.AGENT_SESSION_SEARCH_DIST_LOCK_TIMEOUT_MS
    ),
  });

  try {
    await execFileAsync("npm", ["run", "build"], { cwd });
  } catch (error) {
    await release();
    throw error;
  }

  return async () => {
    await release();
  };
}
