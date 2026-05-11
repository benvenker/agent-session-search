# Agent Ergonomics Scorecard

Pass: 1
Mode: full
Branch: main

| Surface                         | Before | After | Result                                                            |
| ------------------------------- | -----: | ----: | ----------------------------------------------------------------- |
| CLI discovery surfaces          |    420 |   910 | `capabilities --json`, `robot-docs guide`, `--robot-triage` added |
| Planned probes/context from CLI |    380 |   830 | `--probe`, `--cwd`, `--branch`, `--reason` added                  |
| JSON help/errors                |    360 |   850 | `--json --help` and JSON stderr errors added                      |
| CLI resource lifecycle          |    450 |   850 | search pool closes after CLI run                                  |
| Doctor help                     |    250 |   860 | `agent-session-search-doctor --help` exits 0                      |
| Unknown source recovery         |    560 |   820 | warnings list enabled sources and recovery                        |

Median uplift: about +440 points across the changed surfaces.

Validation:

- `npm run check`: pass
- `npm run build`: pass
- `npm test`: pass, 14 files / 73 tests
- `npm run smoke`: pass
- `npm run check:beads`: pass
- `npm run check:fff -- --skip-smoke`: pass
