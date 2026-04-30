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
      "npm pack --dry-run --json",
      "npm pack --pack-destination",
      "npm install --foreground-scripts --no-audit --no-fund",
      "npm trusted publishing",
      "npm version patch",
      "git push origin main --follow-tags",
      "npm run dev:mcp",
      'npm run dev:cli -- "auth token timeout" --json',
      "agent-session-search-mcp",
      "agent-session-search-doctor",
      "agent-session-search help",
      'agent-session-search "auth token timeout" --json',
      "--mode <candidates|evidence|debug>",
      "--evidence",
      "AGENT_SESSION_SEARCH_CONFIG",
      "AGENT_SESSION_SEARCH_FFF_DB_DIR",
      "~/.config/agent-session-search/config.json",
      '"codex"',
      '"claude"',
      '"pi"',
      '"cursor"',
      '"hermes"',
      '"pool"',
      '"include"',
      '"*.jsonl"',
      '"*/agent-transcripts/*"',
      '"trajectories/*.ndjson"',
      'sources: "all"',
      "resultsDisplayMode",
      "--source codex",
      "missing_root",
      "unreadable_root",
      "partial results",
      "Adding another agent",
      "not a closed list",
    ]) {
      expect(readme).toContain(requiredText);
    }
  });
});
