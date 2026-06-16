// smithers-source: generated
import {
  type AgentLike,
  ClaudeCodeAgent as SmithersClaudeCodeAgent,
} from "smithers-orchestrator";
import { ClaudeCodeAgent } from "./agents/claude-code";
import { CodexAgent } from "./agents/codex";
import { OpenCodeAgent } from "./agents/opencode";

export { ClaudeCodeAgent } from "./agents/claude-code";
export { CodexAgent } from "./agents/codex";
export { OpenCodeAgent } from "./agents/opencode";

export const providers = {
  claude: ClaudeCodeAgent,
  codex: CodexAgent,
  opencode: OpenCodeAgent,
  claudeSonnet: new SmithersClaudeCodeAgent({
    model: "claude-sonnet-4-7",
    cwd: process.cwd(),
  }),
} as const;

export const agents = {
  // cheapFast: Smithers would normally suggest Kimi here, but Kimi is not available: missing `kimi` on PATH; missing credentials (~/.kimi).
  // cheapFast: Smithers would normally suggest Vibe here, but Vibe is not available: missing `vibe` on PATH; missing credentials (~/.vibe/.env or ~/.vibe/config.toml or $MISTRAL_API_KEY).
  cheapFast: [providers.claudeSonnet],
  smart: [providers.codex, providers.opencode, providers.claude],
  smartTool: [providers.claude, providers.codex, providers.opencode],
} as const satisfies Record<string, AgentLike[]>;
