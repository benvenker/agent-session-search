# Triage Labels

The skills speak in terms of five canonical triage roles. This repo uses the default role strings in local planning docs and Beads labels/descriptions where useful.

| Label in mattpocock/skills | Label in our tracker | Meaning                                   |
| -------------------------- | -------------------- | ----------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue   |
| `needs-info`               | `needs-info`         | Waiting on reporter or user clarification |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent   |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation or judgment |
| `wontfix`                  | `wontfix`            | Will not be actioned                      |

## Beads Usage

Use `ready-for-agent` only when a bead is self-contained: outcome, acceptance criteria, verification path, non-goals, and failure behavior are clear.

Use `needs-triage` for captured work that still needs shaping.

Use `needs-info` when the bead or plan is blocked on a user/product decision.

Use `ready-for-human` when the work needs human judgment during implementation.

Use `wontfix` when the work is intentionally rejected or obsolete.
