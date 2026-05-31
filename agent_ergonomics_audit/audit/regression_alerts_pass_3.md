# Pass 3 Regression Alerts

No scored surface regressed by more than 50 points.

Notes:

- The full project suite and audit regression scripts are green.
- The first regression-test loop run saw a transient `jq` parse failure in `R-003__json_errors_and_doctor_help.test.sh`; rerunning the same suite after inspecting the generated stderr passed cleanly. The pinned behavior is currently correct: `node dist/cli.js --json` writes JSON to stderr and nothing to stdout.
- Remaining low scores are residual gaps, not regressions: typo-aware CLI parse errors and doctor parse-error pedagogy were not part of the completed recommendation set.
