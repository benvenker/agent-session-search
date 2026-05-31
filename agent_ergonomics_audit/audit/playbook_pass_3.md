# Pass 3 Playbook

## R-008: Typo-aware CLI flag suggestions

Target: `src/cli.ts`

Add a small known-flag table and nearest-match helper for parse errors before search execution. For `--json --jsno`, the JSON stderr envelope should name `--json` and include an exact corrected command. Human stderr should do the same and still show help.

Regression tests:

- `node dist/cli.js --json --jsno` -> exit 1, empty stdout, JSON stderr with `suggestedCommand` containing `--json`.
- `node dist/cli.js --jason "auth token timeout"` -> exit 1, stderr includes `did you mean --json?`.
- Preserve current `node dist/cli.js --json` query-required envelope.

## R-009: Doctor parse-error pedagogy

Target: `src/fff-preflight.ts`

For unknown or missing-value doctor options, print the specific error plus `doctorHelpText()` and a suggested command. Add did-you-mean hints for `--skip-smoke`, `--list-orphans`, `--reap-orphans`, and `--command`.

Regression tests:

- `node dist/fff-preflight.js --wat` -> exit 1, stderr includes `Unknown option: --wat`, `Usage: agent-session-search-doctor`, and a suggested command.
- `node dist/fff-preflight.js --list-orphan` -> exit 1 with `did you mean --list-orphans?`.

## R-010: Exit-code contract expansion

Target: `src/help.ts`, `src/fff-preflight.ts`, docs/tests

Stage after R-008/R-009. Document richer categories in capabilities and use them only where behavior is unambiguous. Keep partial search failures as JSON warnings with exit 0.
