import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("README documentation", () => {
  it("keeps the README as the project front door and delegates reference docs", async () => {
    const readme = await readFile(join(process.cwd(), "README.md"), "utf8");

    for (const requiredText of [
      "Local MCP server and CLI",
      "search_sessions",
      "agent-session-search-doctor",
      'agent-session-search "auth token timeout" --json',
      "agent-session-search-mcp",
      "agent-session-search-native-mcp",
      "fff_native_capabilities",
      "root-wide",
      "Code Mode",
      "more.evidence",
      "AGENT_SESSION_SEARCH_CONFIG",
      '"resultsDisplayMode": "candidates"',
      '"resultsShape": "candidate_groups"',
      '"assignedCandidateCount": { "value": 3, "relation": "eq" }',
      '"hasMore": true',
      '"groupCandidates": {',
      '"planFingerprint": "gcp1:server-prepared"',
      '"fingerprint": "gcf1:server-prepared"',
      "agent-session-search --json --group-candidates @payload.json",
      '"resultsDisplayMode": "evidence"',
      '"paths": ["/absolute/session.jsonl"]',
      '"debug": true',
      "[CLI reference](docs/cli.md)",
      "[MCP tool contract](docs/mcp.md)",
      "[Native MCP opt-in](docs/native-mcp.md)",
      "[Configuration](docs/configuration.md)",
      "[Troubleshooting](docs/troubleshooting.md)",
      "[Release process](docs/maintainers/release.md)",
      "[Contribution policy](CONTRIBUTING.md)",
      "[Design record](DESIGN.md)",
    ]) {
      expect(readme).toContain(requiredText);
    }

    for (const removedBloat of [
      "About Contributions",
      "npm trusted publishing",
      "npm pack --pack-destination",
      "Parse failures are user-input errors",
      "Key modules:",
    ]) {
      expect(readme).not.toContain(removedBloat);
    }
  });

  it("ships the extracted docs with the npm package", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8")
    ) as { files: string[] };

    expect(packageJson.files).toContain("CONTRIBUTING.md");
    // The whole docs tree ships: reference docs, plans (with status
    // frontmatter), ADRs, and investigations are part of the public record.
    expect(packageJson.files).toContain("docs");
  });

  it("pins the grouped progressive-evidence docs contract", async () => {
    const [mcp, cli, troubleshooting, language] = await Promise.all([
      readFile(join(process.cwd(), "docs/mcp.md"), "utf8"),
      readFile(join(process.cwd(), "docs/cli.md"), "utf8"),
      readFile(join(process.cwd(), "docs/troubleshooting.md"), "utf8"),
      readFile(join(process.cwd(), "UBIQUITOUS_LANGUAGE.md"), "utf8"),
    ]);

    for (const requiredMcpText of [
      'resultsShape": "candidate_groups"',
      "countRelationSemantics",
      '"relation": "eq"',
      "hasMore",
      '"groupCandidates": {',
      "more.evidence",
      "same `search_sessions` tool",
    ]) {
      expect(mcp).toContain(requiredMcpText);
    }

    expect(cli).toContain('resultsShape: "candidate_groups"');
    expect(cli).toContain("hasMore");
    expect(cli).toContain("more.groupCandidates");
    expect(cli).toContain("stdout stays empty");

    for (const requiredTroubleshootingText of [
      "multi_grep_fallback",
      "sequential `grep` as the authoritative fallback",
      "metadata.backend",
      "invalid_group_followup",
      "copy `more.groupCandidates` exactly",
      "agent-session-search --json --group-candidates @payload.json",
    ]) {
      expect(troubleshooting).toContain(requiredTroubleshootingText);
    }

    expect(language).toContain("**Candidate Group**");
    expect(language).toContain("**Match Group**");
    expect(language).toContain("**Group Follow-Up**");
    expect(language).toContain("**Count Relation**");
  });
});
