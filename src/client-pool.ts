import {
  createFffMcpClient,
  OneRootFffBackend,
  type CreateFffMcpClientOptions,
  type FffClient,
} from "./fff-backend.js";
import type { ResolvedSessionSource } from "./roots.js";
import type { CreateSessionSearchBackend } from "./search.js";

export type FffBackendPool = {
  createBackend: CreateSessionSearchBackend;
  close(): Promise<void>;
};

export type CreateFffBackendPoolOptions = {
  createClient?: (root: string) => Promise<FffClient>;
  fffMcp?: CreateFffMcpClientOptions;
  timeoutMs?: number;
  emptyResultRetryAttempts?: number;
  emptyResultRetryDelayMs?: number;
};

type PooledClient = {
  client: FffClient;
};

export function createFffBackendPool(
  options: CreateFffBackendPoolOptions = {}
): FffBackendPool {
  const clients = new Map<string, Promise<PooledClient>>();
  const createClient =
    options.createClient ??
    ((root: string) => createFffMcpClient(root, options.fffMcp));

  const createBackend = async (source: ResolvedSessionSource) => {
    const pooled = await clientForRoot(source.root);
    return new OneRootFffBackend({
      source: source.name,
      root: source.root,
      client: {
        grep: (input) => pooled.client.grep(input),
      },
      timeoutMs: options.timeoutMs,
      emptyResultRetryAttempts: options.emptyResultRetryAttempts,
      emptyResultRetryDelayMs: options.emptyResultRetryDelayMs,
    });
  };

  const close = async () => {
    const settledClients = await Promise.allSettled(clients.values());
    clients.clear();
    await Promise.allSettled(
      settledClients.map(async (result) => {
        if (result.status === "fulfilled") {
          await result.value.client.close?.();
        }
      })
    );
  };

  function clientForRoot(root: string) {
    const existing = clients.get(root);
    if (existing) {
      return existing;
    }

    const created = createClient(root)
      .then((client) => ({ client }))
      .catch((error) => {
        clients.delete(root);
        throw error;
      });
    clients.set(root, created);
    return created;
  }

  return { createBackend, close };
}
