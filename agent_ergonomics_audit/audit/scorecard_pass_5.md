# Agent Ergonomics Scorecard - Pass 5

Mode: full / focused progressive-evidence and FFF update pass  
Branch: main  
Target SHA at start: `962e09c94470b49ae966fdd10b4c590d0ef0058d`  
Completed: `2026-06-18T21:05:15Z`

## Summary

Pass 5 targeted the newly changed grouped progressive-evidence surface plus the stale local FFF dependency. The CLI now has a first-class way to replay `more.groupCandidates` payloads, teaches malformed follow-up payloads with the same `invalid_group_followup` code as MCP, suggests close `--mode` values, rejects mixed flags that would otherwise be ignored, and advertises bare discovery commands accurately.

Median current dimension score across the five Pass 5 surfaces: about **905**.  
Surfaces scored: **5**.  
Surfaces with average score >= 700: **5**.  
Surfaces with average score < 700: **0**.  
Regressions > 50 points: **0**.

## Surface Scores

| Surface                             | Current Read | Result                                                                                                                                  |
| ----------------------------------- | -----------: | --------------------------------------------------------------------------------------------------------------------------------------- |
| `cli__group-candidates-followup`    |         ~905 | CLI fallback can expand a prepared candidate group with `--group-candidates @payload.json`.                                             |
| `cli__invalid-group-followup-error` |         ~895 | Malformed group payloads return structured `invalid_group_followup` errors with `invalidField`, `correctedShape`, and an exact command. |
| `cli__result-mode-typo`             |         ~875 | `--mode canddiates` now suggests `--mode candidates` with a copy-pasteable command.                                                     |
| `doctor__fff-stable-version`        |         ~910 | Local FFF MCP is updated to `0.9.5`; doctor/postinstall/docs/tests now recommend `v0.9.5`.                                              |
| `cli__bare-discovery-commands`      |         ~920 | `capabilities` and `sources` are documented as `[--json]` and work as bare JSON discovery commands.                                     |

## Verification

- `fff-mcp --version`: `fff-mcp 0.9.5 (797c045aa93e03e3cec3497a76afe7cb0106bdc2)`
- `npm run build`: pass
- `npm run check`: pass
- `npm test`: pass, 14 files / 135 tests
- `npm run smoke`: pass, 1 file / 4 tests
- `npm run check:beads`: pass
- `npm run check:fff`: pass; live grep passed, `multi_grep` supported, recall equivalence passed
- `for test_script in agent_ergonomics_audit/audit/regression_tests/*.test.sh; do "$test_script"; done`: pass serially after build
