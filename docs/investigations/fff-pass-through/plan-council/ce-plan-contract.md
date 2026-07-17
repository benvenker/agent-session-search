# CE-Plan Authoring Contract (distilled for plan-council agents)

This file distills the `ce-plan` (Compound Engineering) planning-skill contract
to the parts a plan author or reviewer needs. It exists because skill files are
not readable from every agent harness. Follow it exactly when asked to produce
or review a "CE-plan-formatted" plan.

## Artifact metadata (required YAML frontmatter)

```yaml
---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
origin: docs/investigations/fff-pass-through/2026-07-16-code-mode-synthesis.md
---
```

## File naming and location

- Path: `docs/plans/YYYY-MM-DD-NNN-<type>-<descriptive-name>-plan.md`
  (`type` = feat | fix | refactor; `NNN` = next zero-padded sequence for that date).
- ALL file references inside the plan are repo-relative (`src/search.ts`),
  never absolute. Prefer path + symbol/pattern references over line numbers.

## Plan quality bar

Every plan must have: a clear problem frame and scope boundary; requirements
traceability back to the origin document; concrete repo-relative file paths;
decisions with rationale (not just tasks); existing patterns or code references
to follow; enumerated test scenarios per feature-bearing unit specific enough
that an implementer knows exactly what to test; clear dependencies and
sequencing. A plan is ready when an implementer can start confidently without
the plan writing code for them.

## Section contract

Hard floor (always present): Summary, Problem Frame, Requirements, Key
Technical Decisions (KTDs with rationale), Implementation Units.

Include when material: High-Level Technical Design (mermaid diagrams encouraged
for architecture/flows prose can't carry; diagrams are authoritative, no
hedging captions), Scope Boundaries (with `### Deferred to Follow-Up Work` for
known-but-tangential work), Open Questions, System-Wide Impact, Risks &
Dependencies, Alternatives Considered (must differ in _how_ the work is built —
architecture, sequencing, boundaries — not micro-variants), Sources & Research.

Separate sections with horizontal rules (`---`). Write tight: lead with the
decision, one idea per sentence, no placeholder prose. Omit sections that carry
no information for this plan.

## Implementation units

- Break work into logical units, each one meaningful atomic change, ordered by
  dependency. Avoid micro-steps and vague units.
- Each unit is a level-3 heading with a stable ID: `### U1. [Name]`, `### U2. …`.
  U-IDs are never renumbered; gaps from deletions are fine.
- Each unit includes:
  - **Goal** — what it accomplishes
  - **Requirements** — which requirements it advances (trace to origin)
  - **Dependencies** — prior U-IDs
  - **Files** — repo-relative paths to create/modify/test (every feature-bearing
    unit lists its test file path)
  - **Approach** — key decisions, data flow, boundaries, integration notes
  - **Patterns to follow** — existing code/conventions to mirror
  - **Test scenarios** — enumerate specific cases (input → action → expected
    outcome) across every applicable category: happy path, edge cases, error
    and failure paths, integration scenarios. For non-feature-bearing units
    (pure config/scaffolding): `Test expectation: none -- [reason]`.
  - **Verification** — outcome-based completion criteria, not shell scripts.
  - Optional **Execution note** — only for non-default sequencing/proof
    (e.g., "Start with a failing integration test for the contract").

## Planning rules

- Decisions, not code: no imports, exact method signatures, or framework syntax.
  Pseudo-code sketches allowed in HTD or per-unit technical design when framed
  as directional guidance.
- No git commands, commit messages, or exact test command recipes.
- Do not pretend execution-time unknowns are settled — record them explicitly
  under deferred implementation notes.
- Keep planning-time vs implementation-time unknowns separate.
- Tangential cleanup noticed while planning goes to Deferred to Follow-Up Work,
  not into active units.

## Depth for this council

This plan is **Deep**: cross-cutting architectural direction (two-lane FFF
architecture, capability router, opt-in native MCP lane). Use the full template
plus Alternatives Considered, Risks & Dependencies, and phased sequencing where
they add value. 4–8 implementation units, grouped into phases if clearer.
