# Beads and Swarms

Use this guide when turning local plans into Beads or coordinating multi-agent implementation.

## Skill Routing

- Use `better-beads` to create, review, and polish Beads as behavioral execution contracts.
- Use `beads-workflow` to convert markdown plans or PRDs into Beads with dependencies.
- Use `beads-bv` for graph-aware triage, priority, bottlenecks, cycles, and ready work.
- Use `ntm` for exact NTM command contracts, robot surfaces, spawn/send/wait mechanics, and state-changing action verification.
- Use `vibing-with-ntm` for the operator layer: tending loops, stuck panes, convergence checks, queue-dry decisions, and marching orders.
- Use `cass` to recover proven prompts, swarm patterns, and prior decisions before inventing a new orchestration ritual.

## Bead Quality Bar

A Bead is a behavioral execution contract for a fungible coding agent. Before marking a Bead `ready-for-agent`, it must answer:

- What outcome should become true?
- What counts as success?
- How should the agent verify it?
- What is out of scope?
- What failure behavior matters?
- What current surfaces, contracts, or anchors should the agent inspect first?

Do not create one Bead per checklist bullet. Prefer reviewable vertical slices that can be implemented and verified in one coherent PR or commit. Split work when one Bead spans multiple independent levers, shared substrate, response-shape compatibility, broad test harness work, or runtime/public-surface wiring.

Use behavior-first wording. Avoid vague Beads such as "add tests", "clean up", or "polish". Tests belong in the acceptance criteria for the behavior they prove.

## Plan To Beads

Keep early plans and PRDs in markdown until the behavior is understood. When converting to Beads:

1. Read the plan, `AGENTS.md`, `DESIGN.md`, and any relevant prototype findings.
2. Create Beads with `br`; do not edit `.beads/issues.jsonl` directly.
3. Add dependencies with `br dep add`.
4. Make the graph self-contained enough that future agents do not need the original chat.
5. Sync with `br sync --flush-only` when the repo expects JSONL sync.

If several prototype findings target the same narrow product surface, consolidate them into one plan or PRD before creating Beads. Prefer one coherent dependency graph over separate task graphs that compete for the same modules or response contracts.

Prototype code should not be treated as already-mainline implementation. Use it as evidence and reference material; production code should land through implementation Beads or an explicit productionization commit.

After creating or changing the graph, validate:

```bash
br dep cycles --json
bv --robot-insights
bv --robot-plan
```

For dedicated Bead-polish passes, also use the `better-beads` quality gate if available:

```bash
.agents/skills/better-beads/scripts/bead_gate_loop.sh --changed-staged
```

If that repo-local path is not present, continue with `br`/`bv` validation and note that the gate script was unavailable.

## BV Rules

Never run bare `bv` in agent contexts; it launches the TUI and blocks automation.

Use robot mode:

```bash
bv --robot-triage
bv --robot-next
bv --robot-plan
bv --robot-insights
bv --robot-alerts
```

Use `bv --robot-plan` before parallel work so agents do not collide on the same files or dependency chain.

## Swarm Startup

Before spawning or dispatching an NTM swarm:

1. Read `AGENTS.md`, `DESIGN.md`, and the relevant Beads.
2. Check the graph with `br ready --json` and `bv --robot-triage`.
3. Check NTM's live contract with `ntm --robot-capabilities` before relying on unfamiliar robot flags.
4. Capture baseline state with `ntm --robot-snapshot`.
5. Assign one explicit Bead per pane.
6. Assign file or directory ownership before edits.
7. Require Agent Mail reservations when available.

If Agent Mail or reservations are degraded, do not pretend coordination is fine. Have the agent report the exact files it would reserve and stop before editing unless the operator explicitly approves a degraded fallback.

## Swarm Operating Rules

- Beads decide what should happen.
- `bv --robot-*` decides graph truth.
- NTM decides live pane/session truth.
- Agent Mail and file reservations coordinate edits when available.
- Git status, commits, Bead state, and test output are stronger evidence than pane self-report.
- Use `ntm --robot-send` for non-interactive dispatch when CASS duplicate-prompt checks would block `ntm send`.
- Do not use `ntm view` or other human-only TUI surfaces from automation.
- Do not blanket-nudge every pane. Target one pane or one policy lever, then verify the result.
- Do not let agents write subsystem essays instead of shipping. Require "commit real work or surface a blocker" for implementation panes.
- Stop when convergence is real: ready queue empty, in-flight work unchanged, and no expected upstream signal.

## Dispatch Packet Checklist

When sending a Bead packet to an agent, include:

- Repo path and current instructions to read.
- Exact Bead ID and title.
- Explicit non-goals and adjacent Beads not to take.
- Expected file/domain ownership.
- Reservation instructions and degraded-reservation stop behavior.
- Focused verification commands.
- Commit/closeout policy.
- A reminder not to include peer work in commits or Bead closeout.

## CASS Usage

Use CASS to mine recent sessions for proven prompts and failure modes before writing new swarm rituals. Useful searches:

```bash
cass search "vibing-with-ntm better-beads beads-workflow" --json --fields minimal --limit 20
cass search "ship-or-surface SLA ntm br bv ready-for-agent" --json --fields minimal --limit 20
cass search "close the backlog ntm beads swarm" --json --fields minimal --limit 20
```

Treat CASS results as hints. Verify against current repo files, live Beads, and NTM state before acting.
