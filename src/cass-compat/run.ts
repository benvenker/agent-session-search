import { parseCassCompatArgv, type CassCompatCommand } from "./argv.js";
import {
  completeError,
  completeTextSuccess,
  type CassCompatCompletion,
} from "./output.js";
import { packageVersion } from "../package-info.js";
import { completeCassCompatHealth } from "./health.js";

export type CassCompatOperationalHandler = (
  command: CassCompatOperationalCommand
) => CassCompatCompletion | Promise<CassCompatCompletion>;

export type CassCompatOperationalCommand = Exclude<
  CassCompatCommand,
  { verb: "version" | "health" }
>;

export type RunCassCompatOptions = {
  loadOperationalHandler?: (
    command: CassCompatOperationalCommand
  ) => Promise<CassCompatOperationalHandler>;
};

export async function runCassCompat(
  argv: readonly string[],
  options: RunCassCompatOptions = {}
): Promise<CassCompatCompletion> {
  const parsed = parseCassCompatArgv(argv);
  if (!parsed.ok) return parsed.completion;

  const warningOutput =
    parsed.warnings.length === 0 ? "" : `${parsed.warnings.join("\n")}\n`;
  if (parsed.command.verb === "version") {
    return completeTextSuccess(
      `agent-session-search-cass-shim ${packageVersion()} (cass-robot-compat for cm)\n`,
      warningOutput
    );
  }
  if (parsed.command.verb === "health") {
    return completeCassCompatHealth(warningOutput);
  }

  try {
    const loadHandler =
      options.loadOperationalHandler ?? loadDefaultOperationalHandler;
    const handler = await loadHandler(parsed.command);
    const completion = await handler(parsed.command);
    return {
      ...completion,
      stderr: `${warningOutput}${completion.stderr}`,
    };
  } catch (error: unknown) {
    return completeError(
      9,
      "unknown",
      error instanceof Error ? error.message : "Unknown cass shim failure",
      "Retry the command; use ~/.local/bin/cass if the failure persists."
    );
  }
}

async function loadDefaultOperationalHandler(
  command: CassCompatOperationalCommand
): Promise<CassCompatOperationalHandler> {
  const modulePath = `./${command.verb}.js`;
  const loaded = (await import(modulePath)) as {
    handleCassCompatCommand?: unknown;
  };
  if (typeof loaded.handleCassCompatCommand !== "function") {
    throw new Error(
      `Cass compatibility module ${modulePath} does not export handleCassCompatCommand`
    );
  }
  return loaded.handleCassCompatCommand as CassCompatOperationalHandler;
}
