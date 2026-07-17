---
title: "Search Pipeline Prototype Synthesis"
type: synthesis
date: 2026-05-29
status: completed
verified: code-evidence
accuracy: high
status_notes: "Implemented on main; this audit verified closed Beads and current code/test evidence, but did not rerun the full validation suite."
evidence:
  - ".beads/issues.jsonl closes bd-3tv and child search-pipeline Beads."
  - "src/search.ts contains parallel fanout, candidate ranking, project-aware ranking, and debug ranking paths."
  - "src/roots.ts and test/root-resolver.test.ts cover Codex archived-session source coverage."
---

# Search Pipeline Prototype Synthesis

## Summary

Two prototype tracks are ready to move into Beads:

- Parallel source fanout should replace the sequential per-source search loop while preserving deterministic response ordering, warnings, cap behavior, and source failure accounting.
- Default candidate ranking should combine bucketed file recency with capped hit density, and should demote the current live session when it can be identified.

The implementation should keep FFF as the search backend and keep `search_sessions` as the only MCP tool. Prototype code is reference material only.

## Source Findings

- `docs/prototypes/findings/fanout-prototype-findings.md`
- `docs/prototypes/findings/recency-ranking-prototype-findings.md`

## Implementation Boundaries

- Treat fanout as a coordination change inside the existing search flow, not a backend replacement.
- Keep result shaping close to the current FFF result shape.
- Keep candidate and evidence grouping by `source + path`.
- Preserve warning order: root-resolution warnings first, source warnings in configured source order, global warnings last.
- Preserve the existing distinction between `maxResultsPerSource` and `requestMaxResultsPerSource`.
- Do not return ranking scores in the public MCP result shape.
- Do not add embeddings, custom indexing, SQLite stores, markdown exports, or source aggregation.

## Bead Tracks

1. Parallelize source fanout with deterministic slot merging.
2. Add recency plus hit-density candidate ranking and current-session demotion.
3. Add project-aware ranking and debug observability after the core ranking behavior lands.
4. Evaluate the source-coverage gap where CASS can find archived sessions outside configured live roots.

Fanout and ranking both touch `src/search.ts` and `test/search.test.ts`; sequence them by default unless an implementer reserves and splits those files explicitly.

## Verification

Each implementation bead should include focused public-API tests in `test/search.test.ts` plus:

```bash
npm run check
npm test
```

Use narrower Vitest commands during development when useful, but close Beads with the full relevant command output or a clear reason a full command was not run.

## Non-Goals

- Do not merge throwaway prototype harnesses as product code.
- Do not keep raw agent-review transcripts in repo history.
- Do not split Pool into multiple built-in sources.
- Do not make CASS archive coverage part of ranking work; treat it as a separate source-coverage design question.
