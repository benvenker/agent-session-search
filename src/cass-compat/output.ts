import type {
  CassCompatErrorEnvelope,
  CassCompatErrorKind,
  CassCompatExitCode,
} from "./errors.js";

export type CassCompatCompletion = {
  stdout: string;
  stderr: string;
  exitCode: CassCompatExitCode;
};

export const CASS_COMPAT_USAGE_HINT =
  "Use ~/.local/bin/cass for full cass functionality. Supported surfaces: --version, health, search, export, timeline, stats.";

export function jsonWithTrailingNewline(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function completeJsonSuccess(
  value: unknown,
  stderr = ""
): CassCompatCompletion {
  return { stdout: jsonWithTrailingNewline(value), stderr, exitCode: 0 };
}

export function completeTextSuccess(
  stdout: string,
  stderr = ""
): CassCompatCompletion {
  return { stdout, stderr, exitCode: 0 };
}

export function completeError(
  code: Exclude<CassCompatExitCode, 0>,
  kind: CassCompatErrorKind,
  message: string,
  hint: string,
  retryable = false
): CassCompatCompletion {
  const envelope: CassCompatErrorEnvelope = {
    error: { code, kind, message, hint, retryable },
  };
  return {
    stdout: "",
    stderr: jsonWithTrailingNewline(envelope),
    exitCode: code,
  };
}

export function completeUsageError(message: string): CassCompatCompletion {
  return completeError(2, "usage", message, CASS_COMPAT_USAGE_HINT);
}
