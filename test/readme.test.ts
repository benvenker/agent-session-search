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
    expect(packageJson.files).toContain("docs/*.md");
    expect(packageJson.files).toContain("docs/maintainers/*.md");
  });
});
