import type { SourceName } from "../types.js";

export const CASS_COMPAT_AGENT_SLUGS = [
  "claude_code",
  "codex",
  "cursor",
  "gemini",
  "hermes",
  "pi_agent",
] as const;

export type CassCompatAgentSlug = (typeof CASS_COMPAT_AGENT_SLUGS)[number];

const sourceBySlug: Partial<Record<CassCompatAgentSlug, SourceName>> = {
  claude_code: "claude",
  codex: "codex",
  cursor: "cursor",
  gemini: "gemini",
  hermes: "hermes",
  pi_agent: "pi",
};

const slugBySource: Partial<Record<SourceName, CassCompatAgentSlug>> = {
  claude: "claude_code",
  codex: "codex",
  cursor: "cursor",
  gemini: "gemini",
  hermes: "hermes",
  pi: "pi_agent",
};

export function sourceForCassCompatAgent(slug: string): SourceName | undefined {
  return sourceBySlug[slug as CassCompatAgentSlug];
}

export function cassCompatAgentForSource(
  source: SourceName
): CassCompatAgentSlug | undefined {
  return slugBySource[source];
}
