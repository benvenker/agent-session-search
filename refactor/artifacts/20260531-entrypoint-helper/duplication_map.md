## Duplication Map

### Before

- Scanner: `jscpd`
- Scope: `src test`
- Files analyzed: 27
- Clone count: 11
- Duplicated lines: 148 (3.03%)
- Duplicated tokens: 1,251 (3.08%)
- Accepted candidate: exact clone across `src/cli.ts`, `src/server.ts`, and `src/fff-preflight.ts`.

### After

- Scanner: `jscpd`
- Scope: `src test`
- Files analyzed: 28
- Clone count: 10
- Duplicated lines: 138 (2.84%)
- Duplicated tokens: 1,169 (2.89%)

### Rejection Log

| Candidate                                                                 | Reason                                                                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/mcp-smoke.test.ts` / `test/server-pool.test.ts` search-call helpers | Similar, but retry bounds differ intentionally (`10 x 25ms` vs `30 x 100ms` plus assertion), so a shared helper would carry extra variance. |
| `test/packaging.test.ts` rejected-CLI handling                            | Two callsites only; below rule-of-3 threshold.                                                                                              |
| `test/fff-backend.test.ts` include/path filtering setup                   | Similar fixture setup, but tests isolate distinct filtering contracts; lower payoff than production exact clone.                            |
