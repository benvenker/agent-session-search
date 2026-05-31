# Agent Ergonomics Audit Workspace

For tool: `agent-session-search`
Target: this repository

This is a measurement workspace produced by the
`agent-ergonomics-and-intuitiveness-maximization-for-cli-tools` skill.

## Current Status

The audit is idle. Passes 1 through 4 are complete, and recommendations `R-001`
through `R-010` are applied. Pass 4 closed the Pass 3 parse-error queue:
CLI flag typo suggestions, doctor parse-error suggestions, and the published
exit-code contract are now implemented and covered by regression tests. A future
Pass 5 should be re-score-only unless new search or CLI product work changes an
agent-facing surface.

Terminology:

- **Pass**: one whole audit/improvement cycle.
- **Phase**: a step inside a pass. The last completed phase is Pass 4 closeout.
- **Recommendation**: a ranked work item such as `R-002`. Recommendation
  numbers are not pass numbers.

## Layout

- `audit/manifest.json`: entry point with pass number, target SHA, and artifact paths
- `audit/surface_inventory.jsonl`: every agent surface discovered
- `audit/agent_surfaces.jsonl`: surfaces scored across 11 dimensions
- `audit/intent_inference_corpus.jsonl`: wrong-invocation corpus and outcomes
- `audit/recommendations.jsonl`: ranked recommendations
- `audit/applied_changes.jsonl`: what was applied plus commit refs
- `audit/scorecard.md`: human-readable scorecard
- `audit/playbook.md`: top-10 narrative
- `audit/playbook_pass_3.md`: Pass 3 top-10 narrative
- `audit/uplift_diff.md`: pass-N vs pass-N-1 deltas
- `audit/uplift_diff_pass_3.md`: Pass 3 uplift deltas
- `audit/regression_alerts.md`: surfaces that dropped scores
- `audit/regression_alerts_pass_3.md`: Pass 3 regression alerts
- `audit/regression_tests/`: golden/snapshot tests
- `audit/scorecard_pass_3.md`: Pass 3 human-readable scorecard
- `audit/HANDOFF.md`: queued work for the next pass

Some upstream skill templates also mention `audit/heatmap.svg` and
`audit/agent_simulations/`; those artifacts are not present in this workspace.

## How to resume

This workspace lives **inside the target repo** at `agent_ergonomics_audit/` and
is committed alongside the code on the target's current branch. The phase-loop
scripts live in the **skill repo**, not in this workspace. From the skill repo's
root, or with absolute paths, run:

1. `<SKILL>/scripts/discover-cli.sh <repo>` to confirm the binary still exists.
2. `<SKILL>/scripts/validate_pass.sh <repo>/agent_ergonomics_audit` to check artifact integrity.
3. Read `audit/HANDOFF.md` here in the workspace.
4. Pick a mode and send the resumed-pass kickoff prompt.
