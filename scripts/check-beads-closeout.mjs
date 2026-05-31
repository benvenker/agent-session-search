#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const allowFromEnv = process.env.ALLOW_IN_PROGRESS_BEADS ?? "";
const allowFromArgs = process.argv
  .slice(2)
  .flatMap((arg, index, args) => {
    if (arg === "--allow") {
      return args[index + 1] ? [args[index + 1]] : [];
    }
    if (arg.startsWith("--allow=")) {
      return [arg.slice("--allow=".length)];
    }
    return [];
  })
  .join(",");

const allowed = new Set(
  `${allowFromEnv},${allowFromArgs}`
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

function run(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function fail(message, details = "") {
  console.error(`beads closeout check failed: ${message}`);
  if (details) {
    console.error(details.trim());
  }
  process.exit(1);
}

if (process.env.SKIP_BEADS_CLOSEOUT_CHECK === "1") {
  process.exit(0);
}

if (!existsSync(".beads")) {
  process.exit(0);
}

const result = run("br", ["list", "--json"]);

if (result.error) {
  fail(
    "could not run br list --json",
    `${result.error.message}\nInstall br or bypass intentionally with SKIP_BEADS_CLOSEOUT_CHECK=1.`
  );
}

if (result.status !== 0) {
  fail(
    `br list --json exited with status ${result.status}`,
    `${result.stderr || ""}\n${result.stdout || ""}`
  );
}

let parsed;
try {
  parsed = JSON.parse(result.stdout);
} catch (error) {
  fail(
    "br list --json returned invalid JSON",
    `${error.message}\n${result.stdout}`
  );
}

const issues = Array.isArray(parsed) ? parsed : parsed.issues;
if (!Array.isArray(issues)) {
  fail("br list --json did not return an issue list", result.stdout);
}

const unexpectedInProgress = issues.filter(
  (issue) => issue.status === "in_progress" && !allowed.has(issue.id)
);

if (unexpectedInProgress.length === 0) {
  process.exit(0);
}

const issueLines = unexpectedInProgress
  .map((issue) => `  - ${issue.id}: ${issue.title} (P${issue.priority})`)
  .join("\n");

fail(
  "unexpected in-progress beads remain",
  `
${issueLines}

Make each bead truthful before committing or ending the swarm:
  - completed: br close <id> --reason "<evidence>" --json
  - incomplete but runnable later: br update <id> --status open --json
  - genuinely blocked: br update <id> --status blocked --json

Then export Beads state:
  br sync --flush-only

For intentional WIP, rerun with:
  ALLOW_IN_PROGRESS_BEADS=${unexpectedInProgress.map((issue) => issue.id).join(",")} <command>

For an explicit one-off bypass:
  SKIP_BEADS_CLOSEOUT_CHECK=1 <command>
`
);
