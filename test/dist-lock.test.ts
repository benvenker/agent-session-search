import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const helperUrl = pathToFileURL(
  join(process.cwd(), "scripts", "dist-lock.mjs")
).href;

// Child processes exercise the lock the way concurrent `npm test` runs do:
// separate processes, no shared memory, only the on-disk lock to coordinate.
async function writeRunner(dir: string) {
  const runner = join(dir, "runner.mjs");
  await writeFile(
    runner,
    [
      `import { appendFile } from "node:fs/promises";`,
      `import { acquireDistLock } from ${JSON.stringify(helperUrl)};`,
      `const [lockDir, logPath, holdMs, timeoutMs] = process.argv.slice(2);`,
      `const release = await acquireDistLock({`,
      `  cwd: process.cwd(),`,
      `  lockDir,`,
      `  timeoutMs: Number(timeoutMs ?? 60_000),`,
      `});`,
      `const start = Date.now();`,
      `await new Promise((resolve) => setTimeout(resolve, Number(holdMs)));`,
      `const end = Date.now();`,
      `await appendFile(logPath, JSON.stringify({ start, end }) + "\\n");`,
      `await release();`,
    ].join("\n")
  );
  return runner;
}

async function readIntervals(logPath: string) {
  const raw = await readFile(logPath, "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { start: number; end: number })
    .sort((left, right) => left.start - right.start);
}

describe("dist build lock", () => {
  it("serializes concurrent holders across processes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dist-lock-serialize-"));
    const lockDir = join(dir, "lock");
    const logPath = join(dir, "holders.ndjson");
    const runner = await writeRunner(dir);

    await Promise.all(
      Array.from({ length: 3 }, () =>
        execFileAsync(process.execPath, [runner, lockDir, logPath, "150"])
      )
    );

    const intervals = await readIntervals(logPath);
    expect(intervals).toHaveLength(3);
    for (let index = 1; index < intervals.length; index += 1) {
      expect(intervals[index].start).toBeGreaterThanOrEqual(
        intervals[index - 1].end
      );
    }
  }, 30_000);

  it("reclaims a lock whose owner process is gone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dist-lock-stale-"));
    const lockDir = join(dir, "lock");
    const logPath = join(dir, "holders.ndjson");
    const runner = await writeRunner(dir);

    await mkdir(lockDir);
    await writeFile(
      join(lockDir, "owner.json"),
      JSON.stringify({
        // Unused high PID: no live process owns this lock.
        pid: 2 ** 30,
        cwd: dir,
        startedAt: new Date(0).toISOString(),
      })
    );
    const stale = new Date(Date.now() - 120_000);
    await utimes(lockDir, stale, stale);

    await execFileAsync(process.execPath, [runner, lockDir, logPath, "10"]);

    const intervals = await readIntervals(logPath);
    expect(intervals).toHaveLength(1);
  }, 30_000);

  it("does not steal a lock held by a live owner", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dist-lock-live-"));
    const lockDir = join(dir, "lock");
    const logPath = join(dir, "holders.ndjson");
    const runner = await writeRunner(dir);

    await mkdir(lockDir);
    await writeFile(
      join(lockDir, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        cwd: dir,
        startedAt: new Date(0).toISOString(),
      })
    );
    const stale = new Date(Date.now() - 120_000);
    await utimes(lockDir, stale, stale);

    // Short timeout: the child must give up rather than steal a live owner's lock.
    await expect(
      execFileAsync(process.execPath, [runner, lockDir, logPath, "10", "750"])
    ).rejects.toThrow(/Timed out waiting for dist build lock/);
  }, 30_000);
});
