# Issue Tracker

This repo uses a two-stage local workflow.

Planning and PRD drafts live as local markdown. Implementation-ready work lives in Beads via `br`. GitHub is the code remote, not the primary issue tracker for planning or implementation tasks.

## Planning Conventions

Use local markdown for early planning, prototypes, PRDs, and design notes before work is ready for implementation.

Suggested layout:

- `docs/plans/<initiative-slug>/PRD.md` for accepted development plans and PRDs that should outlive scratch work
- `.scratch/<feature-slug>/PRD.md` for private or early PRD drafts
- `.scratch/<feature-slug>/notes.md` for planning notes
- `docs/plans/` for durable PRDs, implementation plans, and cross-prototype synthesis
- `docs/prototypes/findings/` for prototype findings and evaluation data that should survive beyond scratch work

## Prototype Graduation

Prototype branches and worktrees should graduate knowledge before code.

- Merge or copy durable findings into `docs/prototypes/findings/`.
- Synthesize accepted findings into `docs/plans/<initiative-slug>/PRD.md` before creating Beads when multiple ideas overlap.
- Treat prototype code as reference material unless it has an implementation Bead or an explicit productionization decision.
- Do not let throwaway prototype files, toy UIs, or partial implementation diffs reach mainline merely because their findings are valuable.

## Beads Conventions

Use Beads once work is specified enough for an implementation agent.

- Inspect work with `br list --json`, `br show <id> --json`, and `br ready --json` when available.
- Create or update beads with `br`; do not edit `.beads/issues.jsonl` by hand.
- Use `bv --robot-*` for graph inspection. Do not run bare `bv`.
- A bead marked `ready-for-agent` must be self-contained enough for an AFK agent to implement without the original chat.
- Run `br sync --flush-only` after bead mutations if the repo expects JSONL sync, then commit `.beads/` changes explicitly.

## When a Skill Says "Publish To The Issue Tracker"

If the work is still planning-stage, create or update a local markdown file.

If the work is implementation-ready, create or update Beads with `br` and apply the relevant triage vocabulary from `triage-labels.md`.

## When a Skill Says "Fetch The Relevant Ticket"

For markdown plans, read the referenced path.

For Beads, use `br show <id> --json` or `br list --json` and inspect the relevant bead.
