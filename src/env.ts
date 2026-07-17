import { join } from "node:path";
import type { CreateSessionSearchOptions } from "./search.js";

export function searchOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): CreateSessionSearchOptions {
  const fffMcp =
    env.AGENT_SESSION_SEARCH_FFF_MCP_COMMAND ||
    env.AGENT_SESSION_SEARCH_FFF_DB_DIR
      ? {
          ...(env.AGENT_SESSION_SEARCH_FFF_MCP_COMMAND
            ? { command: env.AGENT_SESSION_SEARCH_FFF_MCP_COMMAND }
            : {}),
          ...(env.AGENT_SESSION_SEARCH_FFF_DB_DIR
            ? {
                args: [
                  "--no-update-check",
                  "--frecency-db",
                  join(env.AGENT_SESSION_SEARCH_FFF_DB_DIR, "frecency.mdb"),
                  "--history-db",
                  join(env.AGENT_SESSION_SEARCH_FFF_DB_DIR, "history.mdb"),
                ],
              }
            : {}),
        }
      : undefined;

  return {
    configPath: env.AGENT_SESSION_SEARCH_CONFIG,
    fffMcp,
    fffEmptyResultRetryAttempts: numberFromEnv(
      env.AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_ATTEMPTS
    ),
    fffEmptyResultRetryDelayMs: numberFromEnv(
      env.AGENT_SESSION_SEARCH_FFF_EMPTY_RETRY_DELAY_MS
    ),
    fffTimeoutMs: numberFromEnv(env.AGENT_SESSION_SEARCH_FFF_TIMEOUT_MS),
  };
}

function numberFromEnv(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
