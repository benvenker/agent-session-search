## Summary

| Metric                 |      Before |       After |          Delta | Direction |
| ---------------------- | ----------: | ----------: | -------------: | --------- |
| TypeScript LOC         |       9,721 |       9,706 |            -15 | down      |
| `src/` LOC             |       3,671 |       3,656 |            -15 | down      |
| jscpd clone count      |          11 |          10 |             -1 | down      |
| jscpd duplicated lines | 148 (3.03%) | 138 (2.84%) | -10 (-0.19 pp) | down      |
| Test pass count        |          99 |          99 |              0 | unchanged |
| Typecheck              |        pass |        pass |              0 | unchanged |

## Candidate Ledger

| Candidate                                                              | LOC | Confidence | Risk | Score | Decision | Result                             |
| ---------------------------------------------------------------------- | --: | ---------: | ---: | ----: | -------- | ---------------------------------- |
| Collapse three identical `isEntrypoint` helpers into one shared helper |   2 |          5 |    1 |  10.0 | accepted | Implemented in `src/entrypoint.ts` |

## Verification

- Baseline `npm run check`: passed.
- Baseline `npm test`: 14 files / 99 tests passed.
- After `npm run check`: passed.
- After `npm test`: 14 files / 99 tests passed.
- Duplicate scan: `npx --yes jscpd --min-lines 5 --min-tokens 50 --reporters console --ignore "dist/**,node_modules/**,refactor/**" src test`.

## Remaining Clones

The remaining jscpd clones are test-fixture and smoke-test helper shapes. I left them alone in this pass because they either have two callsites, encode different retry timing, or would require a broader test helper module extraction.
