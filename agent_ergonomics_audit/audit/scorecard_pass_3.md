# Agent Ergonomics Scorecard - Pass 3

Mode: audit-only / re-score against current HEAD  
Branch: main  
Target SHA: `8ddde9cff4d3a84c540bf46b62cd8d5273dc8b1e`  
Completed: `2026-05-31T17:24:26Z`

## Summary

The post-recommendation CLI is in good shape. The first-run and Pass 2 fixes held: the package now exposes agent-readable discovery surfaces, planned-probe/context flags, JSON error envelopes, source inspection, a single MCP `search_sessions` tool, and green regression tests.

Median current dimension score: about **870**.  
Surfaces scored: **11**.  
Surfaces with average score >= 700: **10**.  
Surfaces with average score < 700: **1** (`doctor:unknown-option`).  
Regressions > 50 points from previous scored surfaces: **0**.

## Surface Scores

| Surface                           | Current Read | Result                                                                                                   |
| --------------------------------- | -----------: | -------------------------------------------------------------------------------------------------------- |
| `cli:capabilities`                |         ~925 | Strong machine-readable contract with commands, env vars, result modes, exit codes, and single MCP tool. |
| `cli:robot-triage`                |         ~917 | Strong mega-command shape with quick ref, commands, health checks, and next steps.                       |
| `cli:robot-docs`                  |         ~896 | Useful in-tool agent guide; no external docs needed for the common flow.                                 |
| `cli:sources`                     |         ~899 | Strong source/config inspection, including missing-root and disabled-source state.                       |
| `cli:search-json`                 |         ~886 | Clean stdout JSON, no stderr on success, canonical paths, and `more.evidence` follow-up.                 |
| `cli:unknown-source`              |         ~873 | Unknown source is non-fatal and teaches enabled-source recovery.                                         |
| `mcp:single-search-sessions-tool` |         ~877 | One-tool MCP boundary preserved and smoke-tested.                                                        |
| `doctor:help-and-preflight`       |         ~867 | First-try doctor help and setup diagnostics are solid.                                                   |
| `cli:help`                        |         ~841 | Help is complete and discoverable; still not typo-aware.                                                 |
| `cli:json-errors-and-flag-typos`  |         ~805 | JSON error envelope is good; flag typo recovery is the main remaining gap.                               |
| `doctor:unknown-option`           |         ~661 | Doctor parse errors do not yet teach a corrected command or show usage.                                  |

## Findings

1. **Remaining P1: typo-aware intent inference.** `node dist/cli.js --json --jsno` exits 1 with a parseable JSON error, but the recovery is generic: `agent-session-search help`. A first-time agent would benefit from `did you mean --json?` plus the exact corrected command.
2. **Remaining P2: doctor parse-error pedagogy.** `node dist/fff-preflight.js --wat` exits 1 with only `Unknown option: --wat`. It should include usage or a suggested command, especially because doctor is the setup path agents reach for when FFF is broken.
3. **Remaining P2/P3: exit-code contract is still shallow.** `capabilities --json` documents `0` and `1`; that is acceptable for current tests but leaves environment/upstream failures less machine-classifiable than the rubric wants.

## Verification

- `npm run build`: pass
- `npm run check`: pass
- `npm test`: pass, 14 files / 99 tests
- `npm run smoke`: pass, 1 file / 2 tests
- `npm run check:beads`: pass
- `npm run check:fff -- --skip-smoke`: pass
- `for test_script in agent_ergonomics_audit/audit/regression_tests/*.test.sh; do "$test_script"; done`: pass on rerun

## Recommendation

No urgent broad rework is needed. The next highest-leverage pass should be narrow: implement `R-008` and `R-009` together as an intent/error-pedagogy pass, then consider `R-010` only if scripts can tolerate richer exit-code categories.
