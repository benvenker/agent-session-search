#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();

const fixInstructions = `
Agent fix workflow:
  1. Inspect state: br sync --status --json
  2. If the DB has unexported changes: br sync --flush-only
  3. Stage tracked beads exports: git add -u .beads
  4. Check graph health: br dep cycles --json
  5. Commit again.

Do not edit .beads/issues.jsonl by hand unless resolving a merge conflict.
Never run bare \`bv\`; it opens the interactive TUI. Use robot-safe commands such
as \`bv --robot-next\`, \`bv --robot-triage\`, or \`bv --robot-plan\`.
`;

function run(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function fail(message, details = "") {
  console.error(`beads pre-commit check failed: ${message}`);
  if (details) {
    console.error(details.trim());
  }
  process.exit(1);
}

function parseJsonOutput(result, description) {
  if (result.error) {
    fail(
      `could not run ${description}`,
      `${result.error.message}\nInstall br or bypass intentionally with SKIP_BEADS_CHECK=1.`
    );
  }

  if (result.status !== 0) {
    fail(
      `${description} exited with status ${result.status}`,
      `${result.stderr || ""}\n${result.stdout || ""}`
    );
  }

  const output = result.stdout.trim();
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    fail(`${description} did not return JSON`, output);
  }

  try {
    return JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  } catch (error) {
    fail(`${description} returned invalid JSON`, `${error.message}\n${output}`);
  }
}

function changedTrackedBeadsFiles(args) {
  const result = run("git", [...args, "--", ".beads"]);
  if (result.status !== 0) {
    fail("could not inspect tracked .beads changes", result.stderr);
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

if (process.env.SKIP_BEADS_CHECK === "1") {
  process.exit(0);
}

if (!existsSync(".beads")) {
  process.exit(0);
}

const syncStatus = parseJsonOutput(
  run("br", [
    "sync",
    "--status",
    "--json",
    "--no-auto-flush",
    "--no-auto-import",
  ]),
  "br sync --status"
);

if (syncStatus.dirty_count > 0 || syncStatus.db_newer) {
  fail(
    "the beads database has changes that have not been exported",
    fixInstructions
  );
}

if (syncStatus.jsonl_newer) {
  fail(
    "the beads JSONL export is newer than the local database",
    `
Agent fix workflow:
  1. Inspect state: br sync --status --json
  2. Refresh the DB from JSONL: br sync --import-only
  3. Re-run checks: br sync --status --json && br dep cycles --json
  4. Commit again.

If this came from a merge conflict, resolve .beads/issues.jsonl first.
Never run bare \`bv\`; it opens the interactive TUI. Use robot-safe commands such
as \`bv --robot-next\`, \`bv --robot-triage\`, or \`bv --robot-plan\`.
`
  );
}

const cycles = parseJsonOutput(
  run("br", ["dep", "cycles", "--json", "--no-auto-flush", "--no-auto-import"]),
  "br dep cycles"
);

if ((cycles.count ?? cycles.cycles?.length ?? 0) > 0) {
  fail(
    "beads dependency cycles are present",
    `
Agent fix workflow:
  1. Inspect cycles: br dep cycles --json
  2. Remove or correct the dependency edge with br dep commands.
  3. Export state if needed: br sync --flush-only
  4. Stage tracked beads exports: git add -u .beads
  5. Commit again.

Never run bare \`bv\`; it opens the interactive TUI. Use robot-safe commands such
as \`bv --robot-next\`, \`bv --robot-triage\`, or \`bv --robot-plan\`.
`
  );
}

const unstagedBeadsFiles = changedTrackedBeadsFiles(["diff", "--name-only"]);
if (unstagedBeadsFiles.length > 0) {
  fail(
    "tracked .beads files have unstaged changes",
    `Stage or revert these files before committing:\n${unstagedBeadsFiles.join(
      "\n"
    )}\n\n${fixInstructions}`
  );
}
