# Ubiquitous Language

## Product Surface

| Term                     | Definition                                                                                                         | Aliases to avoid                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| **Agent Session Search** | The local MCP server and CLI that lets agents search prior coding-agent session history across configured sources. | CASS, memory system, session browser               |
| **Search Sessions Tool** | The single agent-facing MCP tool, `search_sessions`, that handles recall search and follow-up evidence retrieval.  | read tool, browse tool, pipeline                   |
| **Recall Task**          | The concise human-readable intent captured in `query` for auditability and query planning.                         | prompt, instruction, user message                  |
| **Planned Probe**        | A short literal search phrase supplied by the calling agent through `queries`.                                     | query variant, search query, keyword               |
| **Literal Pattern**      | A deterministic FFF-friendly string searched against session files.                                                | semantic query, embedding query, regex             |
| **Operational Context**  | Caller-known environment information that helps explain why the recall is being performed.                         | search context, surrounding context, metadata blob |

## Session Corpus

| Term                  | Definition                                                                                     | Aliases to avoid                        |
| --------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Session**           | One recorded coding-agent conversation or run stored on disk.                                  | chat, transcript, file                  |
| **Session History**   | The collection of raw session files written by coding-agent tools.                             | memory store, archive, database         |
| **Session File**      | A raw text file containing one session or agent run.                                           | transcript file, log file, record       |
| **Session Record**    | A single logical record inside a structured session file, often one JSONL line.                | line, message, event                    |
| **JSONL Record**      | A newline-delimited JSON value in a session file.                                              | JSON line, event line, row              |
| **Source**            | A named session-history corpus such as `codex`, `claude`, `cursor`, `pi`, `hermes`, or `pool`. | provider, agent, backend                |
| **Source Root**       | The canonical directory indexed for one source.                                                | root, path, directory                   |
| **Built-In Source**   | A source name and default root shipped by the package.                                         | default agent, built-in root            |
| **Configured Source** | A source declared or overridden in the user's config file.                                     | custom root, configured root            |
| **Canonical Path**    | The absolute real path returned for a session file.                                            | file path, result path, normalized path |

## Search Pipeline

| Term                   | Definition                                                                                                    | Aliases to avoid                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **FFF**                | The external lexical search engine used to search raw session files.                                          | indexer, database, search service                |
| **FFF Child**          | One `fff-mcp` process scoped to one source root.                                                              | backend, worker, subprocess                      |
| **Fanout Search**      | A search that runs the same planned patterns across multiple source roots.                                    | multi-search, aggregation                        |
| **Query Rewriting**    | Deterministic expansion of a recall task into literal patterns.                                               | natural-language understanding, semantic rewrite |
| **Path Normalization** | Conversion of backend paths into canonical absolute paths with source/root metadata preserved.                | path cleanup, canonicalization                   |
| **Partial Success**    | A response that returns available results while reporting failed, missing, or unreadable sources as warnings. | soft failure, degraded mode                      |
| **Warning**            | Structured non-fatal information about missing roots, backend failures, caps, or unknown sources.             | error, log, notice                               |

## Result Model

| Term                   | Definition                                                                                                       | Aliases to avoid                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Candidate**          | A compact session-level result returned by default so the caller can choose which session to inspect.            | search result, lead, file hit           |
| **Preview**            | The short text shown on a candidate from its earliest or representative match.                                   | snippet, excerpt, content               |
| **Evidence**           | More detailed matched content returned when the caller follows up on one or more candidates.                     | context, details, full file             |
| **Evidence Follow-Up** | A server-prepared `more.evidence` payload that the caller can echo to request evidence for a selected candidate. | continuation, next call, browse request |
| **Evidence Group**     | An unscoped evidence result grouped by source and path with representative snippets.                             | grouped result, session summary         |
| **Evidence Hit**       | A path-restricted raw-ish matched result with line, content, query, and pattern metadata.                        | raw result, line match                  |
| **Snippet**            | A small matched text sample included in an evidence group.                                                       | excerpt, preview, context               |
| **Result Shape**       | The structural form of `results`, such as candidates, evidence groups, or evidence hits.                         | display mode, output type               |
| **Result Cap**         | A maximum number of backend hits considered or returned for a source.                                            | limit, page size, max results           |

## Progressive Evidence

| Term                     | Definition                                                                                                       | Aliases to avoid                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Progressive Evidence** | The workflow of starting with candidates and incrementally requesting bounded detail only for selected sessions. | browsing, deep read, context expansion |
| **Anchor Hit**           | The matched line or byte position used as the center of an evidence excerpt.                                     | match, cursor, starting point          |
| **Evidence Excerpt**     | A bounded section of a session file returned around an anchor hit.                                               | snippet, context, file chunk           |
| **Line Context**         | The requested number of nearby lines before and after an anchor hit.                                             | context, window, surrounding lines     |
| **Byte Budget**          | The maximum number of UTF-8 bytes allowed for an excerpt or tool response slice.                                 | token budget, size cap, max length     |
| **Byte Window**          | A byte-bounded region of a file read around an anchor hit.                                                       | chunk, range, excerpt                  |
| **Truncation**           | Deliberate omission of content outside a byte budget, reported with metadata.                                    | clipping, shortening, summarization    |
| **Expansion Handle**     | An opaque or server-prepared follow-up payload for reading more before or after an excerpt.                      | cursor, continuation token, next page  |

## Boundaries

| Term                    | Definition                                                                                      | Aliases to avoid                  |
| ----------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------- |
| **Lexical Recall**      | Search based on exact text patterns present in raw session files.                               | semantic recall, memory retrieval |
| **Semantic Recall**     | Search based on meaning rather than exact text, explicitly outside the current product scope.   | vector search, embeddings, RAG    |
| **Durable Aggregation** | Persistent derived storage such as summaries, custom indexes, or session databases.             | cache, memory, index              |
| **Code Mode**           | A possible future read-only typed API for composing lower-level operations from sandboxed code. | MCP tool sprawl, scripting mode   |

## Relationships

- A **Source** has exactly one active **Source Root** for a search.
- A **Source Root** contains zero or more **Session Files**.
- A **Session File** contains one or more **Session Records** when the format is structured.
- A **Recall Task** may produce one or more **Planned Probes**.
- A **Planned Probe** produces one or more **Literal Patterns**.
- A **Fanout Search** sends **Literal Patterns** to one **FFF Child** per selected **Source Root**.
- A **Candidate** refers to exactly one **Canonical Path**.
- A **Candidate** contains exactly one **Evidence Follow-Up**.
- **Evidence** is requested through the **Search Sessions Tool**, not through a separate public read tool.
- An **Evidence Excerpt** is centered on an **Anchor Hit** and bounded by a **Byte Budget**.
- **Line Context** is a request hint; **Byte Budget** is the hard safety contract.
- **Progressive Evidence** preserves the one-tool product surface while allowing incremental detail.

## Example dialogue

> **Dev:** "When the user asks where we discussed an auth timeout, what should the **Search Sessions Tool** return first?"
>
> **Domain expert:** "Return **Candidates**: each one points to a **Canonical Path**, has a short **Preview**, and includes an **Evidence Follow-Up**."
>
> **Dev:** "If the agent needs more from one large JSONL **Session File**, should it read the file directly?"
>
> **Domain expert:** "Prefer **Progressive Evidence**. The agent echoes the **Evidence Follow-Up**, and the server returns an **Evidence Excerpt** around the **Anchor Hit**."
>
> **Dev:** "So `context: 5` means five lines no matter how large they are?"
>
> **Domain expert:** "No. **Line Context** is only a hint; the **Byte Budget** is the contract, especially for huge **JSONL Records**."
>
> **Dev:** "And we still avoid a separate `read_excerpt` MCP tool?"
>
> **Domain expert:** "Yes. **Evidence** stays inside `search_sessions` unless **Code Mode** becomes a deliberate future surface."

## Flagged ambiguities

- "context" currently means at least three things: LLM context, `operationalContext`, and matching-line context; prefer **Operational Context** for caller metadata and **Line Context** for nearby matched lines.
- "query" and "queries" are too easy to blur; prefer **Recall Task** for `query` and **Planned Probe** for entries in `queries`.
- "pattern" should not mean regex or semantic search; prefer **Literal Pattern** for the FFF search string.
- "source", "root", and "path" are distinct; prefer **Source** for the named corpus, **Source Root** for the indexed directory, and **Canonical Path** for a returned session file.
- "snippet", "preview", and "excerpt" should stay separate; prefer **Preview** on candidates, **Snippet** inside grouped evidence, and **Evidence Excerpt** for bounded file-reading around an anchor.
- "evidence" should not mean full-file content; prefer **Evidence** for matched detail and **Evidence Excerpt** for bounded nearby content.
- "browser" is misleading for this feature because it suggests arbitrary file navigation; prefer **Progressive Evidence**.
- "H2" was used in conversation but is unclear; clarify whether this means a human user, a second-stage agent, or another local term before encoding it into product language.
- "CASS" should remain historical language for the disabled old approach; prefer **Agent Session Search** for this project.
- "read_excerpt" should remain an internal operation name or future code-mode method, not a public MCP tool term unless the one-tool boundary changes.
