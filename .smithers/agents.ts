// smithers-source: generated
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type AgentLike, KimiAgent } from "smithers-orchestrator";
import { type ReviewPanelAgents } from "./components/Review";
import { type PlannerCandidate } from "./components/PlannerPanel";
import {
  ClaudeCodeFableAgent,
  ClaudeCodeOpusAgent,
  ClaudeCodeOpusHighAgent,
  ClaudeCodeOpusMaxAgent,
  createClaudeCodeOpusAgent,
} from "./agents/claude-code";
import {
  Codex55HighAgent,
  Codex55LowAgent,
  Codex55MedAgent,
  Codex56LunaMaxAgent,
  Codex56SolHighAgent,
  Codex56SolMaxAgent,
  Codex56SolMedAgent,
  Codex56SolXHighAgent,
  createCodex55HighAgent,
  createCodex55LowAgent,
  createCodex55MedAgent,
  createCodex56LunaMaxAgent,
  createCodex56SolHighAgent,
  createCodex56SolMaxAgent,
  createCodex56SolMedAgent,
  createCodex56SolXHighAgent,
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
  Codex56LunaMaxAgent,
  Codex56SolHighAgent,
  Codex56SolMaxAgent,
  Codex56SolXHighAgent,
  createCodex55HighAgent,
  createCodex55LowAgent,
  createCodex55MedAgent,
  createCodex56LunaMaxAgent,
  createCodex56SolHighAgent,
  createCodex56SolMaxAgent,
  createCodex56SolXHighAgent,
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

// kimi-code 0.26.x lacks the upstream kimi CLI flags Smithers' KimiAgent
// passes (--print, --final-message-only, --thinking, --work-dir, fresh-uuid
// --session). The shim at .smithers/bin/kimi translates them; prepend it to
// PATH so the agent's `kimi` spawn resolves to the shim first.
const kimiShimBin = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "bin"
);
const kimiShimEnv = {
  PATH: `${kimiShimBin}:${process.env.PATH}`,
};

export const providers = {
  kimiK3: new KimiAgent({
    model: "kimi-code/k3",
    configDir: path.join(homedir(), ".kimi-code"),
    cwd: process.cwd(),
    env: kimiShimEnv,
  }),
  codex: Codex55HighAgent,
  claudeOpus: ClaudeCodeOpusAgent,
  claudeOpusMax: ClaudeCodeOpusMaxAgent,
  claudeOpusHigh: ClaudeCodeOpusHighAgent,
  codex55High: Codex55HighAgent,
  codex55Med: Codex55MedAgent,
  codex55Low: Codex55LowAgent,
  codex56SolMax: Codex56SolMaxAgent,
  codex56SolHigh: Codex56SolHighAgent,
  codex56SolXHigh: Codex56SolXHighAgent,
  codex56SolMed: Codex56SolMedAgent,
  codex56LunaMax: Codex56LunaMaxAgent,
  kimiK3Thinking: new KimiAgent({
    model: "kimi-code/k3",
    thinking: true,
    configDir: path.join(homedir(), ".kimi-code"),
    cwd: process.cwd(),
    env: kimiShimEnv,
  }),
  fable: ClaudeCodeFableAgent,
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
  // cheapFast: Smithers would normally suggest Vibe here, but Vibe is not available: missing `vibe` on PATH; missing credentials (~/.vibe/.env or ~/.vibe/config.toml or $MISTRAL_API_KEY).
  // cheapFast: Smithers would normally suggest Antigravity here, but Antigravity is not available: missing credentials (~/.gemini/antigravity-cli/settings.json or ~/.gemini/antigravity-cli).
  cheapFast: [providers.codex55Low, providers.codex56LunaMax],
  cheapExecution: [providers.glm52],
  kimi: [providers.kimiK3],

  explorer: [providers.codex55Low, providers.codex56LunaMax],
  explorerSynthesis: [providers.codex55Low, providers.codex56LunaMax],

  planner: [plannerSlots.codex.agent, plannerSlots.opus.agent],
  plannerSynthesis: [providers.codex55High, providers.codex56SolHigh],

  engineer: [providers.codex55Med, providers.codex56SolHigh],

  design: [
    providers.claudeOpusMax,
    providers.codex55High,
    providers.codex56SolMax,
  ],
  designSynthesis: [providers.codex55High, providers.codex56SolHigh],

  smart: [providers.codex, providers.claudeOpus, providers.codex56SolMax],
  smartTool: [providers.codex, providers.claudeOpus, providers.codex56SolMax],
  reviewContext: [providers.codex55Low, providers.codex56LunaMax],
  review: reviewPanel,
  reviewSynthesis: [providers.codex55High, providers.codex56SolHigh],
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
    providers.codex56SolHigh,
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
    codex56SolMax: createCodex56SolMaxAgent(env, readOnly),
    codex56SolHigh: createCodex56SolHighAgent(env, readOnly),
    codex56LunaMax: createCodex56LunaMaxAgent(env, readOnly),
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
