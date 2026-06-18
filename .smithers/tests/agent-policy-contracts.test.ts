import { describe, expect, test } from "bun:test";
import { read } from "./helpers";

describe("agent policy contracts", () => {
  test("review policy exposes a required three-slot panel", () => {
    const source = read("agents.ts");
    expect(source).toContain("export const reviewPanel = [");
    expect(source).toContain("] satisfies ReviewPanelAgents");
    expect(source).toContain("review: reviewPanel");
  });

  test("planner panel is keyed by semantic slots, not array order", () => {
    const source = read("agents.ts");
    expect(source).toContain("export const plannerSlots = {");
    expect(source).toContain("plannerSlots.codex.agent");
    expect(source).toContain("plannerSlots.opus.agent");
    expect(source).not.toMatch(/agents\.planner\[[01]\]/);
  });

  test("workflow files do not import providers directly", () => {
    const workflowSources = [
      "workflows/plan.tsx",
      "workflows/research-plan-implement.tsx",
      "components/PlannerPanel.tsx",
    ].map(read);

    for (const source of workflowSources) {
      expect(source).not.toMatch(/from ["']\.\.\/agents\/.*providers/);
      expect(source).not.toContain("providers.");
    }
  });

  test("read-only agent factory preserves non-mutating tool policy", () => {
    const source = read("agents.ts");
    expect(source).toContain("export function createReadOnlySmithersAgents");
    expect(source).toContain("const readOnly = true");
    expect(source).toContain("const piReadOnlyTools = [...PiReadOnlyTools]");
    expect(source).toContain("createCodex55HighAgent(env, readOnly)");
    expect(source).toContain("createCodex55MedAgent(env, readOnly)");
    expect(source).toContain("createCodex55LowAgent(env, readOnly)");
    expect(source).toContain("createClaudeCodeOpusAgent(env, readOnly)");
    expect(source).toContain("createPiGpt55High(env, piReadOnlyTools)");
    expect(source).toContain("createOpenRouterPiAgent");
    expect(source).toContain("piReadOnlyTools)");
  });

  test("provider factories map read-only mode to provider-specific guards", () => {
    const codexSource = read("agents/codex.ts");
    expect(codexSource).toContain(
      'sandbox: readOnly ? "read-only" : undefined'
    );

    const claudeSource = read("agents/claude-code.ts");
    expect(claudeSource).toContain("const claudeReadOnlyTools");
    expect(claudeSource).toContain("const claudeMutationTools");
    expect(claudeSource).toContain(
      "allowedTools: readOnly ? claudeReadOnlyTools : undefined"
    );
    expect(claudeSource).toContain(
      "disallowedTools: readOnly ? claudeMutationTools : undefined"
    );

    const piSource = read("agents/pi.ts");
    expect(piSource).toContain(
      'export const PiReadOnlyTools = ["read", "grep", "find", "ls"] as const'
    );
    expect(piSource).toContain("tools,");
  });
});
