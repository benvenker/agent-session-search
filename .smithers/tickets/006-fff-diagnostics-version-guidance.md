# U6 FFF Diagnostics And Version Guidance

## Objective

Refresh FFF dependency diagnostics so users can understand installed version, current stable guidance, and `multi_grep` capability without automatic upgrades.

## Source Plan

Follow `/data/projects/agent-session-search/docs/plans/2026-06-18-001-feat-fff-native-progressive-evidence-plan.md`, especially U6 and requirements R1, R14, R15, and R16.

## Scope

- Update `src/fff-preflight.ts`, `scripts/postinstall.mjs`, `docs/troubleshooting.md`, `README.md`, `test/fff-preflight.test.ts`, and `test/packaging.test.ts` as needed.
- Report installed FFF version, recommended current stable release, `multi_grep` support, and exact documented upgrade command/path.
- Keep diagnostics advisory and non-destructive.
- Do not install nightly builds, silently upgrade, or mutate user-owned FFF installations.

## Acceptance Criteria

- Doctor/preflight distinguishes pass, missing, warning, and fail states.
- Machine-readable status stays separate from human diagnostics.
- Missing or unsupported `multi_grep` produces a safe fallback recommendation rather than a hard failure when sequential search is usable.
- Postinstall remains non-destructive.

## Verification

- Run FFF preflight and packaging tests.
- Run `npm run check`.
