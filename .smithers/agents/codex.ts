import { CodexAgent as SmithersCodexAgent } from "smithers-orchestrator";

type AgentEnv = Record<string, string>;

// Built-in Codex CLI agent (cliEngine: "codex").
// Tweak `model`, `cwd`, or uncomment extra options below to match your setup.
export function createCodex55HighAgent(env?: AgentEnv, readOnly = false) {
  return new SmithersCodexAgent({
    model: "gpt-5.5",
    cwd: process.cwd(),
    skipGitRepoCheck: true,
    env,
    // systemPrompt: "Add shared instructions for every Codex run.",
    sandbox: readOnly ? "read-only" : undefined,
    // fullAuto: true,
    config: {
      model_reasoning_effort: "high",
    },
  });
}

export const Codex55HighAgent = createCodex55HighAgent();

export function createCodex55MedAgent(env?: AgentEnv, readOnly = false) {
  return new SmithersCodexAgent({
    model: "gpt-5.5",
    cwd: process.cwd(),
    skipGitRepoCheck: true,
    env,
    // systemPrompt: "Add shared instructions for every Codex run.",
    sandbox: readOnly ? "read-only" : undefined,
    // fullAuto: true,
    config: {
      model_reasoning_effort: "medium",
    },
  });
}

export const Codex55MedAgent = createCodex55MedAgent();

export function createCodex55LowAgent(env?: AgentEnv, readOnly = false) {
  return new SmithersCodexAgent({
    model: "gpt-5.5",
    cwd: process.cwd(),
    skipGitRepoCheck: true,
    env,
    // systemPrompt: "Add shared instructions for every Codex run.",
    sandbox: readOnly ? "read-only" : undefined,
    // fullAuto: true,
    config: {
      model_reasoning_effort: "low",
    },
  });
}

export const Codex55LowAgent = createCodex55LowAgent();

export const CodexAgent = Codex55HighAgent;
