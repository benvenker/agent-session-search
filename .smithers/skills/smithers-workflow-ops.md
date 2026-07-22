---
name: smithers-workflow-ops
description: Operate and design Smithers workflows safely, especially detached runs, stuck-run recovery, multi-agent councils, and CLI adapter drift.
---

# Smithers Workflow Ops

Use this skill when launching, supervising, repairing, or designing Smithers workflows, especially council workflows or external CLI-backed agents.

## Operational Rules

- Launch detached workflows as a single fast command. `smithers up -d ...` must return promptly; do not chain it behind slow, watch, inspect, or log-following verbs.
- Treat Smithers engine heartbeat and event history as the liveness source of truth. Step rows can remain `pending` or `in-progress` after a wedged or cancelled run.
- When cancelling, pair `smithers cancel <runId>` with process-group verification. Find descendants by `SMITHERS_RUN_ID` in process environments, confirm the process group is gone, and kill the group explicitly if needed.
- Use `smithers up --hot` for mid-run workflow edits when the active run should pick up code changes.
- Treat `smithers retry-task` as orchestration-state repair only. It resets task/node state and resumes; it does not kill wedged child processes, repair CLI contract mismatches, or guarantee updated workflow code unless hot reload is active.
- Check command exit codes directly. Avoid pipelines or shell constructs that hide the failing command unless `pipefail` or explicit exit capture is used.

## Workflow Design Rules

- Make the workflow own deterministic state: artifact directories, output paths, defaults, schema boundaries, and final file locations.
- Do not trust agent-reported artifact paths. Compute paths in workflow code, pass them into prompts, and use the workflow-owned constants in synthesis, review, and finalization.
- Normalize `ctx.input` explicitly with `??` defaults before use. Smithers inputs may arrive as `null` even when Zod defaults exist.
- Use schema-bound outputs for every agent boundary. Downstream tasks should consume structured outputs plus workflow-owned paths, not free-form agent claims.
- Keep external CLIs behind adapter profiles or shims. Unknown flags, fresh-session failures, and contract drift are configuration errors; fail fast instead of retrying indefinitely.

## Multi-Agent Council Pattern

Use this graph when independent judgment improves quality:

1. Prepare deterministic inputs, baselines, configs, and output paths.
2. Run independent drafters or evaluators in parallel. Each worker gets the same baseline and a deterministic output path.
3. Synthesize all worker outputs into one artifact. The synthesizer reads workflow-owned paths and structured outputs.
4. Review the artifact with a bounded schema-bound reviewer.
5. If review fails and iteration budget remains, revise using review feedback and loop back to review.
6. Finalize only from workflow-owned artifact paths and the latest approved or last-reviewed state.

Use parallelism only for independent work. Synthesis, review, revision, and finalization should be serialized so the workflow owns the canonical result.

## Kimi-Code 0.26 Adapter Shim Pattern

When Smithers `KimiAgent` is pointed at `kimi-code` 0.26.x, add a shim or adapter profile instead of relying on retries:

- Drop unsupported flags: `--print`, `--final-message-only`, `--thinking`, `--no-thinking`.
- Translate `--work-dir <dir>` into `cd <dir>` or spawn `cwd`.
- Drop fresh `--session <id>` values because 0.26 resumes existing sessions and fails on unknown IDs.
- Merge `--mcp-config-file` and inline `--mcp-config` entries into the task cwd `.mcp.json`, preserve existing entries, restore the file afterward, then exec the real `kimi-code` binary.
- Classify `unknown option` and `Session ... not found` as non-retryable adapter/configuration errors.

Keep this shim small and mechanical. The durable fix is a first-class adapter profile, but a PATH shim is acceptable as a local unblocker when it restores the expected contract exactly.
