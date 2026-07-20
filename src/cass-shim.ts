#!/usr/bin/env node
import { isEntrypoint } from "./entrypoint.js";
import {
  completeError,
  type CassCompatCompletion,
} from "./cass-compat/output.js";
import { runCassCompat } from "./cass-compat/run.js";

export type CassShimProcessIo = {
  writeStdout(value: string): void;
  writeStderr(value: string): void;
  setExitCode(value: CassCompatCompletion["exitCode"]): void;
};

export type RunCassShimEntrypointOptions = {
  run?: (argv: readonly string[]) => Promise<CassCompatCompletion>;
  io?: CassShimProcessIo;
};

const processIo: CassShimProcessIo = {
  writeStdout: (value) => process.stdout.write(value),
  writeStderr: (value) => process.stderr.write(value),
  setExitCode: (value) => {
    process.exitCode = value;
  },
};

export function applyCassCompatCompletion(
  completion: CassCompatCompletion,
  io: CassShimProcessIo = processIo
): void {
  if (completion.stdout !== "") io.writeStdout(completion.stdout);
  if (completion.stderr !== "") io.writeStderr(completion.stderr);
  io.setExitCode(completion.exitCode);
}

export async function runCassShimEntrypoint(
  argv: readonly string[],
  options: RunCassShimEntrypointOptions = {}
): Promise<void> {
  const io = options.io ?? processIo;
  try {
    const completion = await (options.run ?? runCassCompat)(argv);
    applyCassCompatCompletion(completion, io);
  } catch (error: unknown) {
    applyCassCompatCompletion(
      completeError(
        9,
        "unknown",
        error instanceof Error ? error.message : "Unknown cass shim failure",
        "Retry the command; use ~/.local/bin/cass if the failure persists."
      ),
      io
    );
  }
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  void runCassShimEntrypoint(process.argv.slice(2));
}
