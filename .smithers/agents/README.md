# Agent Config

These files export the configured agent instances used by your Smithers workflows.

- `claude-code.ts`, `codex.ts`, `gemini.ts`, `pi.ts`, `opencode.ts`, and `antigravity.ts` are user-owned config.
- Edit them to pin models, set `cwd`, add a shared `systemPrompt`, or enable engine-specific flags.
- `index.ts` re-exports the configured agents so root-level files can import from `./agents`.
- Root `.smithers/agents.ts` separates exact provider inventory (`providers`) from workflow-facing routing policy (`agents`). Prefer semantic pools such as `agents.explorer`, `agents.plannerSynthesis`, `agents.engineer`, `agents.design`, `agents.review`, and `agents.reviewSynthesis` in new workflows.
- Planner fan-out should use the exported `plannerPanel` slots so candidate labels stay stable while model selection remains centralized in `agents.planner`.

Examples:

```ts
import { ClaudeCodeOpusAgent } from "./agents";
import { Codex55HighAgent } from "./agents/codex";
import { PiGpt55High } from "./agents/pi";
import { OpenCodeAgent } from "./agents/opencode";
import { AntigravityAgent } from "./agents/antigravity";
```

Inside `.smithers/workflows/*`, use `../agents` or `../agents/<name>` instead.

`smithers init` and `smithers init --agents-only` only create missing files in this directory.
Existing files here are left alone so your custom agent config is preserved.
