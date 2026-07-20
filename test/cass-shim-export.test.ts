import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCassCompat } from "../src/cass-compat/run.js";

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`fixtures/cass-compat/${name}`, import.meta.url));

async function exportFixture(format: "markdown" | "text", name: string) {
  return exportPath(format, fixturePath(name));
}

async function exportPath(format: "markdown" | "text", path: string) {
  return runCassCompat(["export", "--format", format, "--", path]);
}

async function withTempExport(
  content: string,
  run: (path: string) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), "cass-shim-export-"));
  const path = join(directory, "session.jsonl");
  try {
    await writeFile(path, content);
    await run(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("cass compatibility export", () => {
  it("Claude fixture matches cass markdown and text golden outputs", async () => {
    const markdown = await exportFixture("markdown", "claude-session.jsonl");
    const text = await exportFixture("text", "claude-session.jsonl");

    expect(markdown).toEqual({
      stdout:
        "# Plan the migration.\n\n*Started: 2026-07-20 01:00 UTC*\n\n---\n\n## 👤 User\n\nPlan the migration.\n\n---\n\n## 🤖 Assistant\n\nFirst step.\nSecond step.\n\n---\n\n\n",
      stderr: "",
      exitCode: 0,
    });
    expect(text).toEqual({
      stdout:
        "=== USER ===\n\nPlan the migration.\n\n=== ASSISTANT ===\n\nFirst step.\nSecond step.\n\n\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("Codex rollout fixture matches cass markdown and text golden outputs", async () => {
    const markdown = await exportFixture("markdown", "codex-rollout.jsonl");
    const text = await exportFixture("text", "codex-rollout.jsonl");

    expect(markdown).toEqual({
      stdout:
        "# Find the failing test.\n\n*Started: 2026-07-20 02:00 UTC*\n\n---\n\n## 👤 User\n\nFind the failing test.\n\n---\n\n## 🤖 Assistant\n\nThe filter test fails.\nI will fix the cap.\n\n---\n\n\n",
      stderr: "",
      exitCode: 0,
    });
    expect(text).toEqual({
      stdout:
        "=== USER ===\n\nFind the failing test.\n\n=== ASSISTANT ===\n\nThe filter test fails.\nI will fix the cap.\n\n\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("Pi fixture matches cass markdown and text golden outputs", async () => {
    const markdown = await exportFixture("markdown", "pi-session.jsonl");
    const text = await exportFixture("text", "pi-session.jsonl");

    expect(markdown).toEqual({
      stdout:
        "# Inspect the session roots.\n\n*Started: 2026-07-20 03:00 UTC*\n\n---\n\n## 👤 User\n\nInspect the session roots.\n\n---\n\n## 🤖 Assistant\n\nThe roots are canonical.\nIncludes are preserved.\n\n---\n\n\n",
      stderr: "",
      exitCode: 0,
    });
    expect(text).toEqual({
      stdout:
        "=== USER ===\n\nInspect the session roots.\n\n=== ASSISTANT ===\n\nThe roots are canonical.\nIncludes are preserved.\n\n\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("all golden exports score zero under cm's UNKNOWN heuristic", async () => {
    for (const name of [
      "claude-session.jsonl",
      "codex-rollout.jsonl",
      "pi-session.jsonl",
    ]) {
      const completion = await exportFixture("text", name);
      const nonEmptyLines = completion.stdout
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "");
      const unknownHeaderCount = nonEmptyLines.filter(
        (line) => line === "=== UNKNOWN ==="
      ).length;

      expect(completion.exitCode).toBe(0);
      expect(unknownHeaderCount).toBe(0);
      expect(unknownHeaderCount / nonEmptyLines.length).toBe(0);
      expect(completion.stdout).not.toContain("=== UNKNOWN ===");
      expect(completion.stdout).not.toContain(
        "RAW_UNKNOWN_RECORD_MUST_NOT_APPEAR"
      );
      expect(completion.stdout).not.toContain("secret.txt");
      expect(completion.stdout).not.toContain("exec_command");
      expect(completion.stdout).not.toContain("/private/value");
    }
  });

  it("reads JSON arrays and messages containers", async () => {
    const completion = await exportFixture("text", "messages.json");

    expect(completion).toEqual({
      stdout:
        "=== USER ===\n\nContainer hello.\n\n=== ASSISTANT ===\n\nContainer reply.\n\n\n",
      stderr: "",
      exitCode: 0,
    });

    await withTempExport(
      JSON.stringify([
        { role: "user", content: "Array hello." },
        { role: "assistant", content: "Array reply." },
      ]),
      async (path) => {
        const arrayCompletion = await exportPath("text", path);
        expect(arrayCompletion.stdout).toBe(
          "=== USER ===\n\nArray hello.\n\n=== ASSISTANT ===\n\nArray reply.\n\n\n"
        );
      }
    );
  });

  it("concatenates content blocks deterministically", async () => {
    await withTempExport(
      `${JSON.stringify({
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Alpha" },
            { type: "text", text: "Beta" },
            { type: "text", text: "Gamma" },
          ],
        },
      })}\n`,
      async (path) => {
        const completion = await exportPath("text", path);
        expect(completion.stdout).toBe(
          "=== ASSISTANT ===\n\nAlpha\nBeta\nGamma\n\n\n"
        );
      }
    );
  });

  it("accepts conservative generic role and text records", async () => {
    await withTempExport(
      [
        { role: "system", content: "Generic instructions." },
        { role: "user", text: "Generic question." },
        { type: "assistant", message: "Generic answer." },
        { role: "tool", content: "Generic tool result." },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
      async (path) => {
        const completion = await exportPath("text", path);
        expect(completion).toEqual({
          stdout:
            "=== SYSTEM ===\n\nGeneric instructions.\n\n=== USER ===\n\nGeneric question.\n\n=== ASSISTANT ===\n\nGeneric answer.\n\n=== TOOL ===\n\nGeneric tool result.\n\n\n",
          stderr: "",
          exitCode: 0,
        });
      }
    );
  });

  it("skips tool metadata and unknown structural records", async () => {
    await withTempExport(
      [
        { role: "user", content: "Visible text." },
        { role: "tool", content: { path: "RAW_TOOL_METADATA" } },
        { role: "unknown", text: "RAW_UNKNOWN_STRUCTURE" },
        { type: "assistant", message: { nested: "RAW_NESTED_OBJECT" } },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
      async (path) => {
        const completion = await exportPath("text", path);
        expect(completion.stdout).toBe("=== USER ===\n\nVisible text.\n\n\n");
        expect(completion.stdout).not.toContain("RAW_TOOL_METADATA");
        expect(completion.stdout).not.toContain("RAW_UNKNOWN_STRUCTURE");
        expect(completion.stdout).not.toContain("RAW_NESTED_OBJECT");
      }
    );
  });

  it("skips malformed JSONL lines among valid records", async () => {
    await withTempExport(
      `${JSON.stringify({ role: "user", content: "Before malformed." })}\n{ definitely not json\n${JSON.stringify({ role: "assistant", content: "After malformed." })}\n`,
      async (path) => {
        const completion = await exportPath("text", path);
        expect(completion).toEqual({
          stdout:
            "=== USER ===\n\nBefore malformed.\n\n=== ASSISTANT ===\n\nAfter malformed.\n\n\n",
          stderr: "",
          exitCode: 0,
        });
      }
    );
  });

  it("export expands tilde before reading the local session file", async () => {
    await withTempExport(
      `${JSON.stringify({ role: "user", content: "Tilde fixture." })}\n`,
      async (path) => {
        const previousHome = process.env.HOME;
        process.env.HOME = dirname(path);
        try {
          const absolute = await exportPath("text", path);
          const tilde = await exportPath("text", "~/session.jsonl");
          expect(tilde).toEqual(absolute);
          expect(tilde.stdout).toBe("=== USER ===\n\nTilde fixture.\n\n\n");
        } finally {
          if (previousHome === undefined) delete process.env.HOME;
          else process.env.HOME = previousHome;
        }
      }
    );
  });

  it("bounded invalid inputs engage cm fallback with empty stdout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cass-shim-invalid-"));
    try {
      const missing = await exportPath(
        "text",
        join(directory, "missing.jsonl")
      );
      expectFallbackCompletion(missing, 4, "not-found");

      const emptyPath = join(directory, "empty.jsonl");
      await writeFile(emptyPath, "");
      const empty = await exportPath("text", emptyPath);
      expectFallbackCompletion(empty, 9, "empty-session");

      const garbage = await exportFixture("text", "garbage.jsonl");
      expectFallbackCompletion(garbage, 9, "empty-session");
      expect(garbage.stderr).not.toContain("RAW_GARBAGE_MUST_NOT_ECHO");

      const oversizedPath = join(directory, "oversized.jsonl");
      await writeFile(oversizedPath, Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));
      const oversized = await exportPath("text", oversizedPath);
      expectFallbackCompletion(oversized, 9, "empty-session");
      expect(JSON.parse(oversized.stderr).error.message).toBe(
        "Session exceeds maximum export size of 8388608 bytes"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function expectFallbackCompletion(
  completion: { stdout: string; stderr: string; exitCode: number },
  exitCode: 4 | 9,
  kind: "not-found" | "empty-session"
) {
  expect(completion.stdout).toBe("");
  expect(completion.exitCode).toBe(exitCode);
  expect(completion.stderr.match(/"error"/g)).toHaveLength(1);
  const envelope = JSON.parse(completion.stderr);
  expect(envelope.error).toMatchObject({
    code: exitCode,
    kind,
    retryable: false,
  });
}
