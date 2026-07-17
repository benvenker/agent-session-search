# ADR 0001: FFF is the core engine; native-lane policy is fail-closed with a named loosening path

- Status: Accepted
- Date: 2026-07-17

## Context

`agent-session-search` does not treat FFF as a replaceable dependency. FFF is the
search engine the product amplifies: the managed lane adds query rewriting,
source fanout, merging, and warning taxonomy on top of it; the native lane adds
multi-source selection, root-wide unfiltered coverage, and raw presentation
pass-through. Every search runs in upstream `fff-mcp` child processes; this repo
re-implements the MCP server _surface_ (policy, routing, budgets) and none of the
search engine.

The native lane (`agent-session-search-native-mcp`) ships with a fail-closed
policy that pins each exposed upstream tool by a fingerprint of its full tool
definition. Unknown tools and definition drift are hidden until a human reviews
and updates the policy.

The threat model is thin (solo operator, trusted agents, own machine), and the
product value runs the other direction: FFF improvements should flow through to
agents as fast as FFF ships them. Full-fingerprint pinning fights that value:
when an FFF upgrade changes an existing tool's definition, that tool's native
searches are **blocked until re-review** — the strict mode can temporarily
interrupt FFF improvements, not just new capabilities.

## Decision

1. **FFF-as-core is canon.** Extend and amplify FFF; never re-implement its
   search behavior. New capability lands as lanes/frontends over the shared
   router, not as search rewrites.
2. **Keep the shipped fingerprint-pinned policy as the baseline.** The
   "read-only lane" claim is an enforced property, not an assumption, and the
   fingerprint gate is what enforces it against upstream capability expansion.
3. **Named escape hatch: name-allowlist fail-closed.** On the first real drift
   toil — an FFF upgrade changes an existing tool definition and interrupts
   native searches — deliberately loosen the policy to match on tool _name_
   only: new tool names stay blocked (the read-only guarantee holds), while
   definition drift follows FFF automatically (improvements flow through with
   zero toil). This is a planned transition, not a grumble-driven patch.

## Alternatives considered

- **Fail-open (trust + pin the FFF version).** Rejected: "read-only" becomes a
  hope rather than a property, and version pinning rots silently.
- **Fingerprint pinning forever.** Rejected as the steady state: priced in
  review toil on every upstream improvement, misaligned with the amplify-FFF
  product value.

## Consequences

- The managed lane (the common path) is unaffected by native policy strictness.
- Native-lane maintainers own `fff-native-policy.ts` fingerprint updates until
  the escape hatch is triggered; the trigger is the first FFF upgrade that
  interrupts an existing native tool.
- `fff_native_capabilities` remains the audit surface for what is exposed and
  why.
