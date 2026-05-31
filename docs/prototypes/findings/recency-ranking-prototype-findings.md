# Recency Ranking Prototype Findings

Date: 2026-05-29

Status: implemented and extended on `main`. Candidate ranking now combines recency, capped hit density, project matches, ranking debug output, and Codex current-session demotion in `src/search.ts`. Codex archived-session coverage landed separately in `src/roots.ts`. The "Gaps To Fix" section below is historical.

## Question

Can default `search_sessions` candidate ordering improve "where did I just work on this?" recall by composing file recency with hit density, without letting fresh incidental matches or the current live transcript dominate useful historical sessions?

## How We Tested

The production candidate path in `src/search.ts` was wired as the working prototype. This was not a toy TUI after the first correction pass.

Implementation under test:

- Candidate grouping still happens by `source + path`.
- Candidate paths are `stat`ed and ranked by bucketed file `mtime` plus capped log hit density.
- Evidence mode remains unchanged.
- The current Codex thread is demoted when `CODEX_THREAD_ID` matches a candidate `sessionId`.

I used two evaluation sources:

1. Focused synthetic tests in `test/search.test.ts` to pin expected ranking behavior.
2. Cross-project CASS and CM history as a broader known-answer corpus, especially memories from Poolside, CASS maintenance, Agent Mail, and swarm workflows.

Commands used during the pass included:

```bash
cm context "evaluate recency and relevance ranking for agent session search using cross-project CASS history" --json
cass search "initial-learning-swarm2 SilverHarbor MistyGoose" --json --fields minimal --limit 8
cass search "ExternalUrlService OAuth callback xdg-open" --json --fields minimal --limit 8
cass search "degraded-archive-risk missing upstream source paths" --json --fields minimal --limit 8
npm run check
npm run build
npx -y node@22 node_modules/vitest/vitest.mjs run test/search.test.ts -t "orders default candidates|keeps a hot dense|demotes the current"
```

## Synthetic Expectations

These are now encoded as focused tests.

| Scenario                                                      | Expected Order                                         | Result |
| ------------------------------------------------------------- | ------------------------------------------------------ | ------ |
| Fresh weak hit vs dense recent hit vs dense old hit           | Dense recent first, fresh weak second, dense old third | Pass   |
| Hot dense working session vs slightly denser same-day history | Hot dense session first                                | Pass   |
| Current live session echoes a query with many hits            | Historical candidate first, current session demoted    | Pass   |

The focused test run passed:

```text
Test Files  1 passed (1)
Tests       3 passed | 24 skipped (27)
```

## Cross-Project Known-Answer Data

CM suggested several cross-project memories with concrete search terms. CASS then found known-answer clusters outside this repository's own history.

### CASS/CM Seed Cases

| Case                            | Query Terms                                           | CASS/CM Known Answer                                                        |
| ------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Poolside initial-learning swarm | `initial-learning-swarm2 SilverHarbor MistyGoose`     | Codex session `019e3f4c-81e2-75a0-a125-8ea2ea42dd9f` from 2026-05-19        |
| Poolside OAuth handoff          | `ExternalUrlService OAuth callback xdg-open`          | Codex session `019e421a-f5fb-73b3-9d32-41f99f621639` from 2026-05-19        |
| CASS degraded archive risk      | `degraded-archive-risk missing upstream source paths` | CASS repair/debug sessions including `019e4273-0051-78c1-a571-f016597cabad` |

### Before Current-Session Demotion

The current live Codex transcript won nearly every cross-project query because it contained the query terms and the printed CASS/CM outputs from this evaluation session.

| Query                                                 | Top `agent-session-search` Candidate                         | Hit Count | Finding                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------ | --------: | -------------------------------------------------------------- |
| `initial-learning-swarm2 SilverHarbor MistyGoose`     | Current Codex session `019e7321-a388-7db3-8469-b366679dfdb3` |        16 | Bad: live evaluation transcript overshadowed historical answer |
| `ExternalUrlService OAuth callback xdg-open`          | Current Codex session `019e7321-a388-7db3-8469-b366679dfdb3` |        19 | Bad: current transcript contained copied terms                 |
| `degraded-archive-risk missing upstream source paths` | Current Codex session `019e7321-a388-7db3-8469-b366679dfdb3` |        11 | Bad: self-contamination                                        |

This was the strongest signal from the broader corpus. Recency-by-default is useful, but live-session contamination is a real failure mode for agent-history search.

### After Current-Session Demotion

With `CODEX_THREAD_ID=019e7321-a388-7db3-8469-b366679dfdb3`, the current transcript no longer wins those broad queries.

| Query                                             | Current Session Rank After Demotion | Current Session Hit Count | Finding                                                   |
| ------------------------------------------------- | ----------------------------------: | ------------------------: | --------------------------------------------------------- |
| `initial-learning-swarm2 SilverHarbor MistyGoose` |                                   6 |                        43 | Demotion worked despite huge hit count                    |
| `ExternalUrlService OAuth callback xdg-open`      |                                   6 |                        29 | Demotion worked despite huge hit count                    |
| `CASS degraded archive risk` plus explicit probes |                                   3 |                        23 | Demotion worked, but source coverage still limited recall |

This does not solve every known-answer miss, but it fixes the most damaging ranking artifact introduced by recency.

## Source Coverage Finding

CASS can retrieve some known-answer sessions that `agent-session-search` cannot currently retrieve.

Examples:

- `/home/ben/.codex/sessions/2026/05/19/rollout-2026-05-19T08-13-59-019e3f4c-81e2-75a0-a125-8ea2ea42dd9f.jsonl` was returned by CASS but is not present in the live Codex session root.
- `/home/ben/.codex/sessions/2026/05/19/rollout-2026-05-19T21-18-43-019e421a-f5fb-73b3-9d32-41f99f621639.jsonl` was returned by CASS but is not present in the live Codex session root.
- CASS can still know about these through archive/raw-mirror state; `agent-session-search` currently searches configured live roots through FFF.

This means some misses are not ranking misses. They are source-coverage misses.

## Verdict

Keep the working prototype shape, including current-session demotion.

The useful ranking rule is:

1. Group hits into candidates as before.
2. Rank candidates by bucketed file recency plus capped hit-density points.
3. Preserve stable tie-breaks.
4. Demote the current live session below non-current candidates.

This improves the default "where was I just working?" path while avoiding the worst self-contamination behavior found through broad CASS/CM evaluation.

## What The Prototype Gets Right

- It uses actual file `mtime`, avoiding per-agent transcript parsing.
- It composes recency with hit density instead of sorting by raw timestamp.
- It does not change evidence mode.
- It degrades gracefully when `stat` fails: candidates simply receive no recency boost.
- It handles the current-session echo problem observed in real cross-project evaluation.

## Gaps To Fix Before Treating Ranking As Done

1. Add project-aware boosting.
   Cross-project runs showed Pi and unrelated workspace sessions can still appear when they have fresh mtimes. Ranking should use `operationalContext.cwd`, canonical paths, and repo tokens to prefer the current project when the user provides context.

2. Decide how to expose or debug ranking.
   The current implementation keeps scores internal. That is probably right for the public response, but debug mode may need a ranking explanation so bad results are inspectable.

3. Add archived source coverage or CASS-backed source integration.
   CASS found known answers that FFF over live roots cannot see. Recency ranking cannot fix missing source roots.

4. Consider query/probe quality.
   Long natural queries performed worse than sharp literal probes. `--probe` helped for CASS-style known-answer searches.

5. Revisit current-session demotion semantics outside Codex.
   The prototype uses `CODEX_THREAD_ID` and a test-only `currentSessionId` option. Other agents may expose different environment variables or no current-session id.

## Testing Contract

Recommended production tests:

- Candidate ranking: dense recent session beats fresh one-hit noise.
- Candidate ranking: hot dense working session beats slightly denser same-day history.
- Current-session demotion: current session loses to historical candidate even with many more echo hits.
- Missing `mtime`: preserves input order when no candidate mtimes are available.
- Evidence mode: remains unchanged by ranking.
- Debug mode, if ranking details are later exposed: scores explain the returned order without changing normal output.

## Verification

Current verification status:

```text
npm run check  # pass
npm run build  # pass
focused ranking tests under Node 22  # 3 passed
full test/search.test.ts under Node 22 in this worktree  # 25 passed
```

The earlier full-file failure came from accidentally mixing in unrelated evidence-group tests from a different worktree. Those tests are not part of this worktree's recency-ranking prototype.

## Out of Scope

- Replacing FFF.
- Adding embeddings or a new index.
- Returning ranking scores in the public MCP result shape.
- Treating CASS archive/raw-mirror sessions as visible without designing a source integration.
- Keeping any toy TUI prototype. The useful prototype is the working candidate path plus this findings document.
