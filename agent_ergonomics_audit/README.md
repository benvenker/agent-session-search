# Agent Ergonomics Audit Workspace

For tool: `agent-session-search`
Target: this repository

This is a measurement workspace produced by the
`agent-ergonomics-and-intuitiveness-maximization-for-cli-tools` skill.

## Current Status

The audit is idle. Pass 1 and Pass 2 are complete, and recommendations `R-001`
through `R-007` are applied. A future Pass 3 would be a fresh re-score against
current `main`, not required Pass 2 cleanup.

Terminology:

- **Pass**: one whole audit/improvement cycle.
- **Phase**: a step inside a pass. The last completed phase is Pass 2,
  Phase 10 handoff.
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
- `audit/uplift_diff.md`: pass-N vs pass-N-1 deltas
- `audit/regression_alerts.md`: surfaces that dropped scores
- `audit/regression_tests/`: golden/snapshot tests
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
