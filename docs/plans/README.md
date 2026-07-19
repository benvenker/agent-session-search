# Development Plans

Use this directory for accepted plans and PRDs that should guide implementation work between prototype findings and implementation Beads.

## Plan status index

Every plan carries a `status` field in its frontmatter: `open` (accepted, not yet implemented), `completed` (implemented on main), or `superseded` (replaced by a newer plan). This index is the quick read; the frontmatter is the record.

| Plan                                           | Status     | Notes                                                                                              |
| ---------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| 2026-07-18-001 Code Mode R12 gate              | open       | Shipped tool declined; docs-only recipe + revisit protocol; U1–U4 await an implementation worktree |
| 2026-07-16-002 FFF two-lane architecture       | completed  | Shipped in v0.7.0; Code Mode/SDK deferred per R12                                                  |
| 2026-07-16-001 FFF two-lane architecture       | superseded | Replaced by -002                                                                                   |
| 2026-07-16-001 Doctor JSON diagnostics         | completed  | Shipped in v0.7.0                                                                                  |
| 2026-06-18-001 FFF-native progressive evidence | completed  | Progressive evidence groups v2 contract                                                            |
| 2026-06-17-001 Smithers fan-in follow-ups      | completed  | —                                                                                                  |
| search-pipeline-prototype-synthesis            | completed  | Historical synthesis                                                                               |

Planning stages in this repo:

1. Rough notes and early PRD drafts can live in `.scratch/<feature-slug>/`.
2. Durable prototype findings and evaluation data live in `docs/prototypes/findings/`.
3. Accepted development plans and PRDs live in `docs/plans/<initiative-slug>/`.
4. Implementation-ready work lives in Beads via `br`.

Before creating Beads, the relevant plan should make the behavior, boundaries, success criteria, failure behavior, testing strategy, and non-goals explicit enough that an implementation agent would not need the original chat or prototype transcript.

When multiple prototype worktrees explore related ideas, merge the findings into `docs/prototypes/findings/` first, then synthesize one coherent plan here before creating Beads. Treat prototype code as reference material unless a plan or Bead explicitly says to productionize it.
