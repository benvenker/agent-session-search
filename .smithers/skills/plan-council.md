---
name: plan-council
description: Turn the FFF two-lane concept into one reviewed, implementation-ready CE-plan plan.
workflow: plan-council
---

# Plan Council

Use this workflow when the FFF two-lane concept needs to become one implementation-ready CE-plan plan. It resolves the concept input, fans out to three planner drafts, synthesizes a final plan, then reviews and revises it up to three times.

Inputs:

- `prompt` (`string`, optional, default: `docs/investigations/fff-pass-through/2026-07-16-code-mode-synthesis.md`): concept file path or free-text concept input. Free text is materialized to `docs/investigations/fff-pass-through/plan-council/input-concept.md`.

Start it with the default concept or a prompt:

```bash
bunx smithers-orchestrator workflow run plan-council --prompt "docs/investigations/fff-pass-through/2026-07-16-code-mode-synthesis.md"
```

Use structured input when passing explicit JSON:

```bash
bunx smithers-orchestrator workflow run plan-council --input '{"prompt":"docs/investigations/fff-pass-through/2026-07-16-code-mode-synthesis.md"}'
```

Run detached with `-d`, then watch or inspect the run:

```bash
bunx smithers-orchestrator workflow run plan-council -d --prompt "docs/investigations/fff-pass-through/2026-07-16-code-mode-synthesis.md"
smithers ps
smithers logs <runId> -f
smithers inspect <runId>
```

For blocked states, use `smithers approve <runId>` for approval gates, `smithers why <runId>` for signal waits, and `smithers cancel <runId>` to stop the run.
