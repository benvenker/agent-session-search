// smithers-source: generated
import { type AgentLike } from "smithers-orchestrator";
import { type ReviewPanelAgents } from "./components/Review";
import { type PlannerCandidate } from "./components/PlannerPanel";
import {
  ClaudeCodeOpusAgent,
  ClaudeCodeOpusHighAgent,
  ClaudeCodeOpusMaxAgent,
  createClaudeCodeOpusAgent,
} from "./agents/claude-code";
import {
  Codex55HighAgent,
  Codex55LowAgent,
  Codex55MedAgent,
  createCodex55HighAgent,
  createCodex55LowAgent,
  createCodex55MedAgent,
} from "./agents/codex";
import { Gemini31ProAgent } from "./agents/gemini";
import { OpenCodeAgent } from "./agents/opencode";
import {
  PiDeepSeekV4Pro,
  PiGlm51,
  PiGlm52,
  PiGpt55High,
  PiKimiK27Code,
  PiMiniMaxM3,
  PiQwenCoderPlus,
  PiReadOnlyTools,
  createOpenRouterPiAgent,
  createPiGpt55High,
} from "./agents/pi";

export {
  ClaudeCodeFableAgent,
  ClaudeCodeOpusAgent,
  ClaudeCodeOpusHighAgent,
  ClaudeCodeOpusMaxAgent,
  createClaudeCodeOpusAgent,
} from "./agents/claude-code";
export {
  Codex55HighAgent,
  Codex55LowAgent,
  Codex55MedAgent,
  createCodex55HighAgent,
  createCodex55LowAgent,
  createCodex55MedAgent,
} from "./agents/codex";
export { Gemini31ProAgent } from "./agents/gemini";
export { OpenCodeAgent } from "./agents/opencode";
export {
  PiDeepSeekV4Pro,
  PiGlm51,
  PiGlm52,
  PiGpt55High,
  PiKimiK27Code,
  PiMiniMaxM3,
  PiQwenCoderPlus,
  PiReadOnlyTools,
  createOpenRouterPiAgent,
  createPiGpt55High,
} from "./agents/pi";

export const providers = {
  codex: Codex55HighAgent,
  claudeOpus: ClaudeCodeOpusAgent,
  claudeOpusMax: ClaudeCodeOpusMaxAgent,
  claudeOpusHigh: ClaudeCodeOpusHighAgent,
  codex55High: Codex55HighAgent,
  codex55Med: Codex55MedAgent,
  codex55Low: Codex55LowAgent,
  gemini31Pro: Gemini31ProAgent,
  pi: PiGpt55High,
  minimaxM3: PiMiniMaxM3,
  kimiK27Code: PiKimiK27Code,
  glm51: PiGlm51,
  qwenCoderPlus: PiQwenCoderPlus,
  deepSeekV4Pro: PiDeepSeekV4Pro,
  glm52: PiGlm52,
  opencode: OpenCodeAgent,
} as const;

export const plannerSlots = {
  codex: { label: "Codex 5.5 high", agent: providers.codex55High },
  opus: { label: "Claude Opus 4.8 max", agent: providers.claudeOpusMax },
} as const;

export const reviewPanel = [
  providers.codex55High,
  providers.claudeOpusHigh,
  providers.gemini31Pro,
] satisfies ReviewPanelAgents;

export const agents = {
  // cheapFast: Smithers would normally suggest Kimi here, but Kimi is not available: missing `kimi` on PATH; missing credentials (~/.kimi).
  // cheapFast: Smithers would normally suggest Vibe here, but Vibe is not available: missing `vibe` on PATH; missing credentials (~/.vibe/.env or ~/.vibe/config.toml or $MISTRAL_API_KEY).
  // cheapFast: Smithers would normally suggest Antigravity here, but Antigravity is not available: missing credentials (~/.gemini/antigravity-cli/settings.json or ~/.gemini/antigravity-cli).
  cheapFast: [providers.codex55Low],
  cheapExecution: [providers.glm52],

  explorer: [providers.codex55Low],
  explorerSynthesis: [providers.codex55Low],

  planner: [plannerSlots.codex.agent, plannerSlots.opus.agent],
  plannerSynthesis: [providers.codex55High],

  engineer: [providers.codex55Med],

  design: [providers.claudeOpusMax, providers.codex55High],
  designSynthesis: [providers.codex55High],

  smart: [providers.codex, providers.claudeOpus],
  smartTool: [providers.codex, providers.claudeOpus],
  reviewContext: [providers.codex55Low],
  review: reviewPanel,
  reviewSynthesis: [providers.codex55High],
  openRouterCode: [
    providers.minimaxM3,
    providers.kimiK27Code,
    providers.glm51,
    providers.glm52,
    providers.qwenCoderPlus,
    providers.deepSeekV4Pro,
  ],
  beadsPolish: [
    providers.codex55High,
    providers.codex55Med,
    providers.codex55Low,
  ],
} satisfies Record<string, AgentLike[]>;

export const plannerPanel = [
  {
    id: "codex",
    label: plannerSlots.codex.label,
    agent: plannerSlots.codex.agent,
  },
  {
    id: "opus",
    label: plannerSlots.opus.label,
    agent: plannerSlots.opus.agent,
  },
] as const satisfies readonly [PlannerCandidate, PlannerCandidate];

export function createReadOnlySmithersAgents(env: Record<string, string>) {
  const readOnly = true;
  const piReadOnlyTools = [...PiReadOnlyTools];
  return {
    codex55High: createCodex55HighAgent(env, readOnly),
    codex55Med: createCodex55MedAgent(env, readOnly),
    codex55Low: createCodex55LowAgent(env, readOnly),
    claudeOpus: createClaudeCodeOpusAgent(env, readOnly),
    pi: createPiGpt55High(env, piReadOnlyTools),
    minimaxM3: createOpenRouterPiAgent(
      "minimax/minimax-m3",
      env,
      "high",
      piReadOnlyTools
    ),
    kimiK27Code: createOpenRouterPiAgent(
      "moonshotai/kimi-k2.7-code",
      env,
      "high",
      piReadOnlyTools
    ),
    glm51: createOpenRouterPiAgent(
      "z-ai/glm-5.1",
      env,
      "high",
      piReadOnlyTools
    ),
    glm52: createOpenRouterPiAgent(
      "z-ai/glm-5.2",
      env,
      "high",
      piReadOnlyTools
    ),
    qwenCoderPlus: createOpenRouterPiAgent(
      "qwen/qwen3-coder-plus",
      env,
      undefined,
      piReadOnlyTools
    ),
    deepSeekV4Pro: createOpenRouterPiAgent(
      "deepseek/deepseek-v4-pro",
      env,
      "high",
      piReadOnlyTools
    ),
  } as const;
}
