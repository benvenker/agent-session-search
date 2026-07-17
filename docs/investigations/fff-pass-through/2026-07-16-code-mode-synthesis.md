# FFF Pass-Through and Code Mode Synthesis

## How We Got Here

This investigation began with a survey of how Agent Session Search currently mediates access to FFF and where its wrapper might suppress, reinterpret, or fail to expose useful FFF behavior. That survey found a deliberately strong session-recall experience around source multiplexing, canonical paths, candidate ranking, and progressive evidence, alongside a narrow and lossy internal FFF adapter.

A subsequent GPT Pro review argued that the public `search_sessions` boundary was already the right product abstraction. It shifted the emphasis from exposing more native FFF surface area to correcting search semantics, pagination, completeness reporting, parser fidelity, and coverage exclusions inside the managed path.

The resulting synthesis was: keep the public interface session-native, make the internal FFF integration capability-aware, and explicitly classify each upstream capability as internally used, translated into a session concept, or intentionally hidden.

The remaining question was whether Code Mode changed that conclusion. After that possibility was raised, GPT-5.6 Sol Pro proposed a two-lane architecture: retain `search_sessions` for managed recall, while providing an opt-in programmable lane generated from FFF's own MCP schema. The assessment below responds to that proposal and identifies the generic source-bound capability router as the durable core, with Code Mode as one possible frontend.

I think Sol Pro has found the missing architectural piece. I’m about **85% aligned**:

> Keep `search_sessions` as the dependable product, and add an opt-in native FFF capability lane for agents that need full control.

That is better than either forcing every FFF feature into `search_sessions` or adding a raw result mode to the managed workflow.

**Where It’s Right**

- A generated, source-bound FFF interface avoids manually duplicating every upstream parameter.
- Code Mode is a legitimate pattern, not hand-waving. Cloudflare specifically recommends its single-code-tool form for wrapping a manageable MCP server, and Anthropic describes the client-side generated-TypeScript equivalent. [Cloudflare Code Mode patterns](https://developers.cloudflare.com/agents/model-context-protocol/codemode/), [Anthropic’s MCP code-execution article](https://www.anthropic.com/engineering/code-execution-with-mcp).
- It preserves the strong default experience while providing an advanced escape hatch.
- It correctly separates `ManagedSessionSearch` from a raw `FffNativeProxy`.
- It does not excuse the managed lane’s current strictness, pagination, parser, coverage, or `context` problems.

**Corrections I’d Make**

1. Call it **automatic discovery, not automatic exposure**.

   New tools still need read-only classification, call budgets, and policy approval. Unknown tools cannot safely become executable merely because they appeared in `tools/list`.

2. It provides only partial “automatic parity.”

   `tools/list` covers MCP tools and input schemas. It does not cover new FFF command-line flags, and FFF’s results remain largely presentation-oriented text rather than a typed output schema. Runtime configuration and structured-output work remain separate concerns.

3. Do not make Code Mode the foundational abstraction.

   Build a generic `FffCapabilityRouter` first:

   ```text
   listSources()
   listTools()              // complete schemas, not names only
   call(source, tool, args) // raw CallToolResult
   ```

   Managed search, a native proxy MCP, a code tool, and a future SDK can all sit on top of that. Currently `listTools()` discards everything except names ([fff-backend.ts](/data/projects/agent-session-search/src/fff-backend.ts:557)).

4. I would not start with server-side Code Mode.

   Cloudflare’s implementation uses Dynamic Workers and its current guidance still treats this area as experimental. Retrofitting that into a local Node/stdio package is a sizable infrastructure and sandboxing project. [Cloudflare implementation guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-openapi-mcp-server/).

5. The proposed npm SDK has installation friction.

   This package is normally installed globally ([README.md](/data/projects/agent-session-search/README.md:27)), while it currently publishes no library exports or TypeScript declarations ([package.json](/data/projects/agent-session-search/package.json:16)). An arbitrary coding workspace cannot reliably import a globally installed npm package.

**My Preferred Sequence**

1. Fix the correctness promises of `search_sessions`.
2. Introduce the generic, source-bound FFF router internally.
3. Prototype a separate opt-in `agent-session-search-native-mcp` that dynamically mirrors approved FFF schemas with a required `source`.
4. Evaluate a `session_search_code` frontend on the same router when programmable fanout, pagination, and result filtering demonstrate enough value.
5. For coding agents, separately prototype a CLI/code SDK, but test global-install and module-resolution ergonomics before choosing it as the canonical native lane.

Keeping the native server as a separate entrypoint is especially clean: the ordinary server still exposes exactly one tool at [server.ts](/data/projects/agent-session-search/src/server.ts:32), while users who want upstream FFF semantics explicitly opt into them.

So yes, I think the **two-lane architecture is the strongest synthesis so far**. My only substantial disagreement is sequencing: the durable design is the generic capability router; Code Mode is one promising presentation of that router, not the core itself.
