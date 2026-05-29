# Prototype Lifecycle

Use prototypes to answer focused product or architecture questions before creating implementation Beads.

## Durable Artifacts

Merge evidence, not accidental scaffolding.

- Keep durable prototype findings and measured results in `docs/prototypes/findings/`.
- Keep PRDs, implementation plans, and cross-prototype synthesis in `docs/plans/`.
- Treat source files named like `prototype-*`, temporary package scripts, local transcripts, and scratch harnesses as throwaway unless the plan explicitly promotes them.

## Worktree Flow

1. Run experiments in a prototype worktree.
2. Record what was tested, what changed your mind, and what remains uncertain.
3. Merge the durable docs back to the main planning branch.
4. Repeat for other prototype worktrees that touch the same product surface.
5. Synthesize overlapping findings into a single plan before creating Beads.

Because this package has a narrow public surface, prefer one coherent plan and Beads graph for overlapping search-pipeline changes. Do not create separate Beads graphs for each prototype unless the implementation surfaces are truly independent.

## Promotion Rule

A prototype artifact belongs in product history only when it has a continuing role:

- A findings document is evidence for planning.
- A review document is supporting signal, but should be summarized into findings instead of kept by default.
- A script or harness is useful only if it becomes a documented repeatable tool.
- A package script is useful only if future agents are expected to run it.

If a prototype script is promoted, move or rename it so its purpose is clear, document the command that runs it, and explain whether it is a temporary validation harness or a supported developer tool.

## Before Beads

Do not convert prototype findings directly into Beads. First write or update a plan in `docs/plans/` that states:

- the user-visible behavior to change,
- the implementation boundaries,
- the success criteria,
- the warning and failure behavior,
- the testing strategy,
- the explicit non-goals.

Then use the Beads workflow to turn that plan into self-contained execution contracts.
