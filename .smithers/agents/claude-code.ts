import { ClaudeCodeAgent as SmithersClaudeCodeAgent } from "smithers-orchestrator";

type AgentEnv = Record<string, string>;
type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

// Built-in Claude Code CLI agent (cliEngine: "claude-code").
// Tweak `model`, `cwd`, `CLAUDE_CODE_LOCAL_PATH`, or uncomment extra options below to match your setup.
const claudeLocalPath =
  process.env.CLAUDE_CODE_LOCAL_PATH ??
  (process.env.HOME ? `${process.env.HOME}/.claude/local` : undefined);
const claudePathEnv = [claudeLocalPath, process.env.PATH]
  .filter(Boolean)
  .join(":");
const claudeReadOnlyTools = ["Read", "Grep", "Glob", "LS"];
const claudeMutationTools = [
  "Bash",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
];

export function createClaudeCodeOpusAgent(
  env: AgentEnv = {},
  readOnly = false,
  effort: ClaudeEffort = "max"
) {
  return new SmithersClaudeCodeAgent({
    model: "claude-opus-4-8",
    cwd: process.cwd(),
    env: {
      PATH: claudePathEnv,
      ...env,
    },
    allowedTools: readOnly ? claudeReadOnlyTools : undefined,
    disallowedTools: readOnly ? claudeMutationTools : undefined,
    disableSlashCommands: readOnly ? true : undefined,
    permissionMode: readOnly ? "dontAsk" : undefined,
    // systemPrompt: "Add shared instructions for every Claude run.",
    // timeoutMs: 10 * 60 * 1000,
    // dangerouslySkipPermissions: true,
    extraArgs: ["--effort", effort],
  });
}

export const ClaudeCodeOpusMaxAgent = createClaudeCodeOpusAgent();
export const ClaudeCodeOpusHighAgent = createClaudeCodeOpusAgent(
  {},
  false,
  "high"
);
export const ClaudeCodeOpusAgent = ClaudeCodeOpusMaxAgent;

export function createClaudeCodeFableAgent(env: AgentEnv = {}) {
  return new SmithersClaudeCodeAgent({
    model: "claude-fable-5",
    cwd: process.cwd(),
    env: {
      PATH: claudePathEnv,
      ...env,
    },
    extraArgs: ["--effort", "xhigh"],
  });
}

export const ClaudeCodeFableAgent = createClaudeCodeFableAgent();

export const ClaudeCodeAgent = ClaudeCodeOpusAgent;
