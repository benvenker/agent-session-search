import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { searchOptionsFromEnv } from "../src/env.js";

describe("searchOptionsFromEnv", () => {
  it("maps environment variables to session search options", () => {
    const dbDir = "/tmp/agent-session-search-fff";

    expect(
      searchOptionsFromEnv({
        AGENT_SESSION_SEARCH_CONFIG: "/tmp/config.json",
        AGENT_SESSION_SEARCH_FFF_DB_DIR: dbDir,
        AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_ATTEMPTS: "4",
        AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_DELAY_MS: "125",
        AGENT_SESSION_SEARCH_FFF_TIMEOUT_MS: "2500",
      })
    ).toEqual({
      configPath: "/tmp/config.json",
      fffMcp: {
        args: [
          "--no-update-check",
          "--frecency-db",
          join(dbDir, "frecency.mdb"),
          "--history-db",
          join(dbDir, "history.mdb"),
        ],
      },
      fffEmptyResultRetryAttempts: 4,
      fffEmptyResultRetryDelayMs: 125,
      fffTimeoutMs: 2500,
    });
  });

  it("ignores invalid numeric environment values", () => {
    expect(
      searchOptionsFromEnv({
        AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_ATTEMPTS: "nope",
        AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_DELAY_MS: "also-nope",
        AGENT_SESSION_SEARCH_FFF_TIMEOUT_MS: "still-nope",
      })
    ).toEqual({
      configPath: undefined,
      fffMcp: undefined,
      fffEmptyResultRetryAttempts: undefined,
      fffEmptyResultRetryDelayMs: undefined,
      fffTimeoutMs: undefined,
    });
  });
});
