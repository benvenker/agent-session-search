import {
  PiAgent as SmithersPiAgent,
  type PiAgentOptions,
} from "smithers-orchestrator";

type AgentEnv = Record<string, string>;
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const PiReadOnlyTools = ["read", "grep", "find", "ls"] as const;

export function createOpenRouterPiAgent(
  model: string,
  env?: AgentEnv,
  thinking?: ThinkingLevel,
  tools?: string[],
  mode?: PiAgentOptions["mode"]
) {
  return new SmithersPiAgent({
    provider: "openrouter",
    model,
    thinking,
    tools,
    mode,
    env,
  });
}

export function createPiGpt55Pro(env?: AgentEnv, tools?: string[]) {
  return new SmithersPiAgent({
    provider: "openai",
    model: "gpt-5.5-pro",
    thinking: "high",
    tools,
    env,
  });
}

export const PiGpt55Pro = createPiGpt55Pro();

export function createPiGpt55High(env?: AgentEnv, tools?: string[]) {
  return new SmithersPiAgent({
    provider: "openai",
    model: "gpt-5.5",
    thinking: "high",
    tools,
    env,
  });
}

export const PiGpt55High = createPiGpt55High();

export function createPiGpt55XHigh(env?: AgentEnv, tools?: string[]) {
  return new SmithersPiAgent({
    provider: "openai",
    model: "gpt-5.5",
    thinking: "xhigh",
    tools,
    env,
  });
}

export const PiGpt55XHigh = createPiGpt55XHigh();

export function createPiGpt55Low(env?: AgentEnv, tools?: string[]) {
  return new SmithersPiAgent({
    provider: "openai",
    model: "gpt-5.5",
    thinking: "low",
    tools,
    env,
  });
}

export const PiGpt55Low = createPiGpt55Low();

export const PiMiniMaxM3 = createOpenRouterPiAgent(
  "minimax/minimax-m3",
  undefined,
  "high"
);
export const PiKimiK27Code = createOpenRouterPiAgent(
  "moonshotai/kimi-k2.7-code",
  undefined,
  "high"
);
export const PiGlm51 = createOpenRouterPiAgent(
  "z-ai/glm-5.1",
  undefined,
  "high"
);
export const PiGlm52 = createOpenRouterPiAgent(
  "z-ai/glm-5.2",
  undefined,
  "high"
);
export const PiQwenCoderPlus = createOpenRouterPiAgent("qwen/qwen3-coder-plus");
export const PiDeepSeekV4Pro = createOpenRouterPiAgent(
  "deepseek/deepseek-v4-pro",
  undefined,
  "high"
);
