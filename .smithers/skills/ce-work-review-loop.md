---
name: ce-work-review-loop
description: Implement a change with ce-work, review it with ce-code-review, and retry from review findings until it passes or reaches the iteration cap.
workflow: ce-work-review-loop
---

# CE Work Review Loop

Use this workflow when a requested code change should be implemented and independently reviewed before handoff. It runs ce-work, runs ce-code-review on the result, then starts a fresh implementation retry with the prior findings when the review reports blocking issues.

Inputs:

- `prompt` (`string`, default: `"Implement the requested change."`): the implementation request.
- `maxIterations` (`number`, int 1-6, default: `3`): maximum implement/review attempts before returning the last result.

Start it with a simple prompt:

```bash
bunx smithers-orchestrator workflow run ce-work-review-loop --prompt "Implement the requested change."
```

Use structured input when setting knobs:

```bash
bunx smithers-orchestrator workflow run ce-work-review-loop --input '{"prompt":"Fix the failing auth timeout test.","maxIterations":4}'
```

Run detached with `-d`, then watch or inspect the run:

```bash
bunx smithers-orchestrator workflow run ce-work-review-loop -d --prompt "Implement the requested change."
smithers ps
smithers logs <runId> -f
smithers inspect <runId>
```

For blocked states, use `smithers approve <runId>` for approval gates, `smithers why <runId>` for signal waits, and `smithers cancel <runId>` to stop the run.
