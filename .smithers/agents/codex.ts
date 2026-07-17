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

// GPT-5.6 family (GA 2026-07-09). Codex CLI 0.144.5 supports slugs
// gpt-5.6-sol / gpt-5.6-terra / gpt-5.6-luna; Sol efforts: low..max + ultra,
// Luna efforts: low..max. `max` is the top single-agent effort; `ultra` is a
// multi-agent mode available on Sol only.
export function createCodex56SolMaxAgent(env?: AgentEnv, readOnly = false) {
  return new SmithersCodexAgent({
    model: "gpt-5.6-sol",
    cwd: process.cwd(),
    skipGitRepoCheck: true,
    env,
    sandbox: readOnly ? "read-only" : undefined,
    config: {
      model_reasoning_effort: "max",
    },
  });
}

export const Codex56SolMaxAgent = createCodex56SolMaxAgent();

export function createCodex56SolHighAgent(env?: AgentEnv, readOnly = false) {
  return new SmithersCodexAgent({
    model: "gpt-5.6-sol",
    cwd: process.cwd(),
    skipGitRepoCheck: true,
    env,
    sandbox: readOnly ? "read-only" : undefined,
    config: {
      model_reasoning_effort: "high",
    },
  });
}

export const Codex56SolHighAgent = createCodex56SolHighAgent();

export function createCodex56SolXHighAgent(env?: AgentEnv, readOnly = false) {
  return new SmithersCodexAgent({
    model: "gpt-5.6-sol",
    cwd: process.cwd(),
    skipGitRepoCheck: true,
    env,
    sandbox: readOnly ? "read-only" : undefined,
    config: {
      model_reasoning_effort: "xhigh",
    },
  });
}

export const Codex56SolXHighAgent = createCodex56SolXHighAgent();

export function createCodex56LunaMaxAgent(env?: AgentEnv, readOnly = false) {
  return new SmithersCodexAgent({
    model: "gpt-5.6-luna",
    cwd: process.cwd(),
    skipGitRepoCheck: true,
    env,
    sandbox: readOnly ? "read-only" : undefined,
    config: {
      model_reasoning_effort: "max",
    },
  });
}

export const Codex56LunaMaxAgent = createCodex56LunaMaxAgent();

export const CodexAgent = Codex55HighAgent;
