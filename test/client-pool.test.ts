import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFffBackendPool } from "../src/client-pool.js";
import { createSessionSearch } from "../src/search.js";
import type { FffClient } from "../src/fff-backend.js";

describe("createFffBackendPool", () => {
  it("reuses one FFF client per source root across searches until the pool closes", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-pool-"));
    const root = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(root);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: root, include: ["*.jsonl"] }],
      })
    );

    const createdRoots: string[] = [];
    const grepQueries: string[] = [];
    let closeCount = 0;
    const pool = createFffBackendPool({
      async createClient(clientRoot): Promise<FffClient> {
        createdRoots.push(clientRoot);
        return {
          async grep(input) {
            grepQueries.push(input.query);
            return {
              content: [
                {
                  type: "text",
                  text: `session.jsonl\n 1: ${input.query} result`,
                },
              ],
              isError: false,
            };
          },
          async close() {
            closeCount += 1;
          },
        };
      },
    });
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend: pool.createBackend,
    });

    try {
      await search.searchSessions({ query: "first", sources: ["codex"] });
      await search.searchSessions({ query: "second", sources: ["codex"] });

      expect(createdRoots).toEqual([await realpath(root)]);
      expect(grepQueries).toEqual(["first", "second"]);
      expect(closeCount).toBe(0);
    } finally {
      await pool.close();
    }

    expect(closeCount).toBe(1);
  });
});
