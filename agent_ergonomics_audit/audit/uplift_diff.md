# Uplift Diff

This was the first pass, so there is no prior scorecard artifact to diff against.

Measured uplift was computed from pre-pass runtime/source findings versus post-pass tests and dist smoke checks:

- Discovery/self-documentation: +490 on CLI discovery surfaces.
- Agent ergonomics: +450 on planned probe/context support.
- Output parseability: +490 on JSON help/error behavior.
- Error pedagogy: +320 on unknown-source recovery and JSON parse errors.
- Regression resistance: +300 through focused Vitest coverage and audit regression scripts.
