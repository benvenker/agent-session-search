# Pass 3 Uplift / Regression Diff

Compared against Pass 1/2 applied recommendations, the key improvements held:

| Area                          | Prior Applied Target                                             | Pass 3 Result                                                                      |
| ----------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Discovery surfaces            | `capabilities --json`, `robot-docs guide`, `--robot-triage`      | Still present, JSON-valid, and regression-tested.                                  |
| Planned probes/context        | `--probe`, `--cwd`, `--branch`, `--reason`                       | Still documented in help and mapped into `SearchSessionsInput`.                    |
| JSON errors                   | `--json` parse failures produce a JSON stderr envelope           | Still passes; `node dist/cli.js --json` exits 1 with JSON stderr and empty stdout. |
| Resource lifecycle            | CLI closes search resources after invocation                     | Still covered by code path and project tests.                                      |
| Doctor help                   | `agent-session-search-doctor --help` exits 0                     | Still passes.                                                                      |
| Unknown source recovery       | Warnings name enabled sources and recovery path                  | Still passes with fixture config.                                                  |
| MCP/version/source inspection | Package version, text-JSON MCP result, CLI-only `sources --json` | Still passes smoke and regression tests.                                           |

Regression alerts over 50 points: **none**.

Newly visible residual gaps:

- `cli:json-errors-and-flag-typos`: parseable but not typo-aware.
- `doctor:unknown-option`: terse parse errors without usage/suggestion.
- Exit-code contract remains limited to `0` and `1`.
