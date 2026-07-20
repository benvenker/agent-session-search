# Optional cass compatibility shim

`agent-session-search-cass-shim` is an optional subprocess compatibility adapter for cm. It presents live, index-free FFF search in the cass wire shapes that cm consumes. It is not an `agent-session-search` CLI subcommand, an MCP tool or server, a cass passthrough, an index repair command, or a persistent migration.

## Compatibility baseline

The pinned consumer baseline is **cm 0.2.12 (2026-07-19 build)** with the observable contracts of **cass 0.6.22**. Maintainers must re-verify argv, schemas, and cm consumption heuristics on every cm upgrade. The package does not currently ship an automated contract-drift script.

The adapter implements exactly six surfaces:

- `--version`
- `health [--json]`
- `search [--limit N] [--days N] [--agent SLUG]... [--workspace PATH] [--fields CSV] [--robot] [--json] -- QUERY`
- `export --format markdown|text -- SESSION_PATH`
- `timeline --since 7d|7 [--json]`
- `stats [--json]`

The `--` separators, repeated `--agent`, `--fields`, `--robot`, `--days`, `--workspace`, positive `--since` values with or without `d`, and `--json` match the pinned cm calls. Unknown flags produce a warning for forward compatibility. Unsupported commands never pass through to real cass.

## Streams and exit codes

Successful data is written only to stdout. Warnings and structured errors are written to stderr.

| Exit | Meaning                                                                    |
| ---: | -------------------------------------------------------------------------- |
|  `0` | Success, including a valid zero-hit search                                 |
|  `2` | Invalid argv or unsupported surface                                        |
|  `4` | Requested export file not found                                            |
|  `9` | Runtime failure, all search sources failed, or an empty/unparseable export |

The shim never emits cass's index-missing exit `3` because it has no index. It never emits cass's timeout exit `10`; cm owns the subprocess timeout. Failures use the shape `{ error: { code, kind, message, hint, retryable } }` on stderr with empty stdout.

## Search contract

Search calls Agent Session Search in-process in candidates mode. `--days` and the canonical `--workspace` are passed directly to the shared deterministic filters before caps and ranking. There is no shim-local post-filter. A bounded per-source overfetch is flattened in candidate-group priority and lead order, deduplicated by source and canonical path, and then sliced to the global limit.

Known cass agent slugs map as follows:

| cass / emitted slug | Agent Session Search source |
| ------------------- | --------------------------- |
| `claude_code`       | `claude`                    |
| `pi_agent`          | `pi`                        |
| `codex`             | `codex`                     |
| `cursor`            | `cursor`                    |
| `gemini`            | `gemini`                    |
| `hermes`            | `hermes`                    |

Repeated known slugs restrict the search to those sources. An unsupported slug returns a successful zero-hit envelope and a stderr diagnostic listing accepted slugs; it never broadens the search.

The pretty-printed JSON response has these outer fields:

```text
query, limit, offset, count, total_matches, hits,
max_tokens, request_id, cursor, hits_clamped
```

Each hit includes `title`, `snippet`, `content`, `score`, `source_path`, `agent`, `line_number`, `match_type`, `source_id`, and `origin_kind`. `line_number` is always numeric and falls back to `1`. `content` equals the grounded snippet. `score` is a synthetic monotonic ordinal for stable ordering, not a relevance score and not comparable with cass scores. `workspace` is echoed only when requested; the shim does not infer or dash-decode it. `created_at` is emitted only when filesystem stat succeeds and is the file's epoch `mtimeMs`. Paths remain canonical absolute session paths.

Partial source failures remain exit-0 results with warnings on stderr. When every backend source fails, the shim returns exit `9` with an error envelope instead of claiming a successful empty search.

## Timeline and stats honesty

`timeline --since 7d --json` walks live configured roots, orders files newest-first, caps the result at the newest 1000 sessions, and groups them by UTC hour (`YYYY-MM-DD HH:00`). Each entry deliberately reports `message_count: 0`: pinned cm consumes its path and agent, and the index-free walker does not parse every transcript merely to count messages.

`stats --json` performs metadata-only enumeration with a per-root cap of 5000 files. It reports `messages: null` with a not-computed note, discloses caps and truncation, and includes a `shim` marker naming `agent-session-search-cass-shim` and the live/no-index engine. Conversation counts are bounded filesystem observations, not index totals.

Missing roots and individual unreadable files are warnings when healthy roots can still produce data. No timeline or stats command creates an index, cache, raw mirror, or durable aggregate.

## Export exception

`export` is a bounded, cm-only markdown/text renderer for known Claude, Codex, Pi, and conservative generic message records. Input is capped at 8 MiB. Unrecognized records are skipped, raw records are never echoed as conversation text, and the renderer never emits an `UNKNOWN` role header. Missing files exit `4`; existing oversized, empty, or wholly unparseable files exit `9` so cm can use its own fallback.

This adapter renderer is the narrow shim-only exception to `DESIGN.md`'s markdown-export Non-Goal. It is not a reusable transcript-export API or a general Agent Session Search export feature.

## Activation

Prefer environment-scoped activation while evaluating the adapter:

```bash
CASS_PATH="$(pwd)/dist/cass-shim.js" cm doctor
CASS_PATH="$(pwd)/dist/cass-shim.js" cm context "recent work" --json
CASS_PATH="$(pwd)/dist/cass-shim.js" cm reflect --dry-run --days 1
```

For an installed package, use the absolute result of `command -v agent-session-search-cass-shim`. cm also supports a persistent `cassPath` config option; set it to that absolute executable path only after the environment-scoped checks pass. The shim itself never rewrites cm or cass-memory configuration.

## Diagnostics

Check the adapter directly before involving cm:

```bash
agent-session-search-cass-shim --version
agent-session-search-cass-shim health --json
agent-session-search-cass-shim search --limit 5 --days 7 --robot -- "vitest"
agent-session-search-cass-shim timeline --since 7d --json
agent-session-search-cass-shim stats --json
agent-session-search-cass-shim export --format text -- /absolute/session.jsonl
```

Then run `cm doctor`, `cm context "recent work" --json`, and `cm reflect --dry-run --days 1` with the environment-scoped `CASS_PATH`. Doctor should show the shim marker and explain that sessions are searched live with no index; it should not diagnose an index as missing. Context should contain real history without degraded fallback, and reflect should process sessions without `UNKNOWN` blocks or export-fallback warnings.

## Rollback

The rollback path depends only on how cm was activated:

- Environment activation: remove the `CASS_PATH=...` prefix or `unset CASS_PATH`.
- Persistent cm activation: remove `cassPath` or restore its previous value in cm's configuration.

Rollback requires no session migration, cache cleanup, index rebuild, or package-configuration rewrite because activation changes only which subprocess cm invokes.

## Predecessor requirement

The shim requires the Agent Session Search `--days`/`--workspace` filter contract. Backporting it ahead of those filters loses required cm fidelity. There is no supported degraded implementation and no shim-local fallback or post-filter.
