import {
  createFffMcpClient,
  OneRootFffBackend,
  type CreateFffMcpClientOptions,
  type FffClient,
  type FffRawToolResult,
  type FffToolResult,
} from "./fff-backend.js";
import { FffCapabilityRouter } from "./fff-capability-router.js";
import type { ResolvedSessionSource } from "./roots.js";
import type { CreateSessionSearchBackend } from "./search.js";

export type FffBackendPool = {
  createBackend: CreateSessionSearchBackend;
  createBackendFromRouter(
    source: ResolvedSessionSource,
    router: FffCapabilityRouter
  ): OneRootFffBackend;
  clientForRoot(root: string): Promise<FffClient>;
  createRouter(sources: ResolvedSessionSource[]): FffCapabilityRouter;
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
    const router = createRouter([source]);
    return createBackendFromRouter(source, router);
  };

  const createBackendFromRouter = (
    source: ResolvedSessionSource,
    router: FffCapabilityRouter
  ) => {
    return new OneRootFffBackend({
      source: source.name,
      root: source.root,
      client: {
        grep: async (input) =>
          (
            await router.call(source.name, "grep", {
              query: input.query,
              maxResults: input.maxResults,
            })
          ).result,
        multiGrep: async (input) =>
          (
            await router.call(source.name, "multi_grep", {
              patterns: input.patterns,
              maxResults: input.maxResults,
            })
          ).result,
        listTools: () => router.listTools(source.name),
        callTool: async (input) =>
          (await router.call(source.name, input.name, input.arguments)).result,
      },
      timeoutMs: options.timeoutMs,
      emptyResultRetryAttempts: options.emptyResultRetryAttempts,
      emptyResultRetryDelayMs: options.emptyResultRetryDelayMs,
    });
  };

  const createRouter = (sources: ResolvedSessionSource[]) =>
    new FffCapabilityRouter({
      sources,
      clientForRoot: async (root) => (await clientForRoot(root)).client,
    });

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
      .then((client) => ({ client: normalizeClient(client) }))
      .catch((error) => {
        clients.delete(root);
        throw error;
      });
    clients.set(root, created);
    return created;
  }

  return {
    createBackend,
    createBackendFromRouter,
    clientForRoot: async (root) => (await clientForRoot(root)).client,
    createRouter,
    close,
  };
}

function normalizeClient(client: FffClient): FffClient {
  if (client.callTool) {
    return client;
  }
  return {
    ...client,
    async callTool(input) {
      if (input.name === "grep") {
        const args = input.arguments ?? {};
        return toRawToolResult(
          await client.grep({
            query: String(args.query ?? ""),
            maxResults:
              typeof args.maxResults === "number" ? args.maxResults : undefined,
          })
        );
      }
      if (input.name === "multi_grep" && client.multiGrep) {
        const args = input.arguments ?? {};
        return toRawToolResult(
          await client.multiGrep({
            patterns: Array.isArray(args.patterns)
              ? args.patterns.map(String)
              : [],
            maxResults:
              typeof args.maxResults === "number" ? args.maxResults : undefined,
          })
        );
      }
      throw new Error(`FFF client does not support tool: ${input.name}`);
    },
  };
}

function toRawToolResult(result: FffToolResult): FffRawToolResult {
  return {
    ...result,
    content: result.content ?? [],
  } as FffRawToolResult;
}
