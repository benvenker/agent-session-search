/**
 * Narrow cm-interop adapter exception to DESIGN.md's transcript-export non-goal.
 * This module exists only to satisfy cm's cass subprocess contract; it is not a
 * general transcript converter or a package API.
 */
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import type { CassCompatOperationalCommand } from "./run.js";
import {
  completeError,
  completeTextSuccess,
  type CassCompatCompletion,
} from "./output.js";

type ExportRole = "user" | "assistant" | "system" | "tool";

type ExportMessage = {
  role: ExportRole;
  text: string;
};

// cm fallback remains the safer behavior above this documented 8 MiB bound.
const MAX_CASS_COMPAT_EXPORT_BYTES = 8 * 1024 * 1024;

export async function handleCassCompatCommand(
  command: CassCompatOperationalCommand
): Promise<CassCompatCompletion> {
  if (command.verb !== "export") {
    throw new Error(`Export handler received ${command.verb}`);
  }

  const exportPath = resolveExportPath(command.path);
  let fileMtime: Date;
  try {
    const file = await stat(exportPath);
    fileMtime = file.mtime;
    if (file.size > MAX_CASS_COMPAT_EXPORT_BYTES) {
      return completeError(
        9,
        "empty-session",
        `Session exceeds maximum export size of ${MAX_CASS_COMPAT_EXPORT_BYTES} bytes`,
        "Allow cm to use its own fallback parser for this session."
      );
    }
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return missingFileCompletion(exportPath);
    }
    throw error;
  }
  let input: string;
  try {
    input = await readFile(exportPath, "utf8");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return missingFileCompletion(exportPath);
    }
    throw error;
  }
  const records = parseRecords(input);
  const messages = records
    .map(extractMessage)
    .filter((message): message is ExportMessage => message !== undefined);
  if (messages.length === 0) {
    return completeError(
      9,
      "empty-session",
      `No confidently parsed messages in session: ${exportPath}`,
      "Allow cm to use its own fallback parser for this session."
    );
  }
  const startedAt = firstTimestamp(records) ?? fileMtime;
  const title =
    messages
      .find((message) => message.role === "user")
      ?.text.split(/\r?\n/, 1)[0]
      ?.trim() || basename(exportPath, extname(exportPath));

  return completeTextSuccess(
    command.format === "markdown"
      ? renderMarkdown(title, startedAt, messages)
      : renderText(messages)
  );
}

function missingFileCompletion(exportPath: string): CassCompatCompletion {
  return completeError(
    4,
    "not-found",
    `Session file not found: ${exportPath}`,
    "Verify the local session path and retry."
  );
}

function resolveExportPath(input: string): string {
  if (input === "~") return process.env.HOME ?? homedir();
  if (input.startsWith("~/")) {
    return resolve(join(process.env.HOME ?? homedir(), input.slice(2)));
  }
  return resolve(input);
}

function parseRecords(input: string): unknown[] {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (isRecord(parsed) && Array.isArray(parsed.messages)) {
      return parsed.messages;
    }
    return [parsed];
  } catch {
    return input
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
  }
}

function extractMessage(record: unknown): ExportMessage | undefined {
  return (
    extractClaudeMessage(record) ??
    extractCodexMessage(record) ??
    extractPiMessage(record) ??
    extractGenericMessage(record)
  );
}

function extractClaudeMessage(record: unknown): ExportMessage | undefined {
  if (!isRecord(record) || !isRecord(record.message)) return undefined;
  const role = record.message.role;
  if (!isExportRole(role)) return undefined;
  const text = contentText(record.message.content);
  return text === undefined ? undefined : { role, text };
}

function extractCodexMessage(record: unknown): ExportMessage | undefined {
  if (!isRecord(record) || !isRecord(record.payload)) return undefined;
  const role = record.payload.role;
  if (!isExportRole(role)) return undefined;
  if (!Array.isArray(record.payload.content)) return undefined;
  const text = record.payload.content
    .flatMap((block) =>
      isRecord(block) &&
      (block.type === "input_text" || block.type === "output_text") &&
      typeof block.text === "string"
        ? [block.text.trim()]
        : []
    )
    .filter((value) => value !== "")
    .join("\n");
  const normalized = nonEmpty(text);
  return normalized === undefined ? undefined : { role, text: normalized };
}

function extractPiMessage(record: unknown): ExportMessage | undefined {
  if (!isRecord(record) || record.type !== "message") return undefined;
  const role = record.role;
  if (!isExportRole(role)) return undefined;
  const text = contentText(record.content);
  return text === undefined ? undefined : { role, text };
}

function extractGenericMessage(record: unknown): ExportMessage | undefined {
  if (!isRecord(record)) return undefined;
  const role = record.role ?? record.type;
  if (!isExportRole(role)) return undefined;
  const content = record.content ?? record.text ?? record.message;
  const text = contentText(content);
  return text === undefined ? undefined : { role, text };
}

function contentText(content: unknown): string | undefined {
  if (typeof content === "string") return nonEmpty(content);
  if (!Array.isArray(content)) return undefined;
  const text = content
    .flatMap((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
        ? [block.text.trim()]
        : []
    )
    .filter((value) => value !== "")
    .join("\n");
  return nonEmpty(text);
}

function firstTimestamp(records: readonly unknown[]): Date | undefined {
  for (const record of records) {
    if (!isRecord(record) || typeof record.timestamp !== "string") continue;
    const timestamp = new Date(record.timestamp);
    if (!Number.isNaN(timestamp.valueOf())) return timestamp;
  }
  return undefined;
}

function renderMarkdown(
  title: string,
  startedAt: Date,
  messages: readonly ExportMessage[]
): string {
  const started = `*Started: ${startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC*`;
  const blocks = messages.map(
    (message) => `## ${markdownRole(message.role)}\n\n${message.text}`
  );
  return `# ${title}\n\n${started}\n\n---\n\n${blocks.join("\n\n---\n\n")}\n\n---\n\n\n`;
}

function renderText(messages: readonly ExportMessage[]): string {
  return `${messages
    .map(
      (message) => `=== ${message.role.toUpperCase()} ===\n\n${message.text}`
    )
    .join("\n\n")}\n\n\n`;
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function isExportRole(value: unknown): value is ExportRole {
  return (
    value === "user" ||
    value === "assistant" ||
    value === "system" ||
    value === "tool"
  );
}

function markdownRole(role: ExportRole): string {
  switch (role) {
    case "user":
      return "👤 User";
    case "assistant":
      return "🤖 Assistant";
    case "system":
      return "system";
    case "tool":
      return "tool";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error;
}
