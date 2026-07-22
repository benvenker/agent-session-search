---
name: mcp-eval-council
description: Evaluate the managed MCP server, native FFF MCP server, and CLI with live multi-model probes.
workflow: mcp-eval-council
---

# MCP Eval Council

Use this workflow when Agent Session Search's managed MCP lane, native FFF lane, and CLI need a live read-only evaluation. It builds the repo, writes hermetic MCP configs, probes both stdio servers, runs four model evaluators, synthesizes a report, then verifies the Smithers scaffold.

Inputs:

- `prompt` (`string`, optional): run context or evaluation instructions for the council.
- `reportDate` (`string`, default: `"2026-07-17"`): date segment for `docs/investigations/fff-pass-through/evals/<reportDate>-native-lane-eval.md`.
- `maxConcurrency` (`number`, int 1-8, default: `4`): evaluator fan-out concurrency.
- `planPath` (`string`, default: `"docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md"`): plan the evaluators compare against.
- `repoRoot` (`string`, default: `process.cwd()`): repository root used for build, config generation, probes, and verification.

Start it with a prompt:

```bash
bunx smithers-orchestrator workflow run mcp-eval-council --prompt "Evaluate the current managed/native MCP lanes and CLI."
```

Use structured input when setting knobs:

```bash
bunx smithers-orchestrator workflow run mcp-eval-council --input '{"prompt":"Evaluate the current MCP lanes.","reportDate":"2026-07-17","maxConcurrency":4}'
```

Run detached with `-d`, then watch or inspect the run:

```bash
bunx smithers-orchestrator workflow run mcp-eval-council -d --prompt "Evaluate the current managed/native MCP lanes and CLI."
smithers ps
smithers logs <runId> -f
smithers inspect <runId>
```

For blocked states, use `smithers approve <runId>` for approval gates, `smithers why <runId>` for signal waits, and `smithers cancel <runId>` to stop the run.
