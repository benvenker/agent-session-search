# Session Mining

Tool used: `agent-session-search` CLI, not CASS.

Useful handles:

- `/Users/ben/.codex/sessions/2026/04/29/rollout-2026-04-29T11-45-04-019dda21-3d3e-74a0-89be-9583303fe430.jsonl`
- `/Users/ben/.codex/sessions/2026/04/29/rollout-2026-04-29T12-56-05-019dda62-408d-7d00-9e77-75cf1804d05f.jsonl`
- `/Users/ben/.codex/sessions/2026/04/30/rollout-2026-04-30T07-51-23-019dde71-a53e-7082-b993-c4f5f53c8f65.jsonl`

Themes applied in this pass:

- Preserve the candidate-first default and keep `more.evidence` reusable.
- Preserve raw user intent in `query` while allowing planned literal probes in `queries`.
- Carry cwd, branch, and reason in `operationalContext` instead of polluting the search query.
- Keep bad input loud and parseable.
- Keep FFF setup explicit through `agent-session-search-doctor`.
