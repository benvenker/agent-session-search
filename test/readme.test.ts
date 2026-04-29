import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("README setup documentation", () => {
  it("documents the clean local setup and search behavior", async () => {
    const readme = await readFile(join(process.cwd(), "README.md"), "utf8");

    expect(readme).not.toContain(
      "search backend is implemented by the follow-up beads"
    );

    for (const requiredText of [
      "npm install",
      "npm run check:fff",
      "npm run check",
      "npm test",
      "npm run build",
      "npm run smoke",
      "npm run dev:mcp",
      'npm run dev:cli -- "auth token timeout" --json',
      "agent-session-search-mcp",
      "agent-session-search-doctor",
      'agent-session-search "auth token timeout" --json',
      "AGENT_SESSION_SEARCH_CONFIG",
      "AGENT_SESSION_SEARCH_FFF_DB_DIR",
      "~/.config/agent-session-search/config.json",
      '"codex"',
      '"claude"',
      '"pi"',
      '"cursor"',
      '"hermes"',
      '"include"',
      '"*.jsonl"',
      '"*/agent-transcripts/*"',
      'sources: "all"',
      "--source codex",
      "missing_root",
      "unreadable_root",
      "partial results",
      "CASS is not part of this tool",
      "Do not run cass",
    ]) {
      expect(readme).toContain(requiredText);
    }
  });
});
