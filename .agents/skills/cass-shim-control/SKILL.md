---
name: cass-shim-control
description: >-
  Control which engine backs cass-memory (cm): real cass or the opt-in
  agent-session-search-cass-shim. Use when cm or cass is degraded, when asked
  to set up, activate, deactivate, or verify the shim, or to check which
  engine cm is currently using.
---

# cm Shim Control (cass-compat)

`agent-session-search-cass-shim` is the opt-in cass CLI adapter for cass-memory (cm). The on/off switch lives entirely on cm's side — it selects which subprocess cm invokes as `cass` — never in this package. Installing or upgrading agent-session-search never activates the shim.

`docs/cass-shim.md` is the authoritative runbook (activation, acceptance checks, diagnostics, rollback). This skill is the short operational map plus the agent guardrails.

## The Switch

Session-scoped, preferred for trials:

```bash
CASS_PATH="$(command -v agent-session-search-cass-shim)" cm context "recent work" --json
export CASS_PATH="$(command -v agent-session-search-cass-shim)"   # shell session on
unset CASS_PATH                                                   # off
```

From a repository checkout, the target is `dist/cass-shim.js` after `npm run build`.

Persistent: set `cassPath` in cm's configuration (`~/.cass-memory/config.json`) to the absolute shim path, only after session-scoped checks pass. Off = remove the key or restore its previous value; cm falls back to the real `cass` on `PATH`.

Rollback in either direction requires no session migration, cache cleanup, or index rebuild — the switch only changes which subprocess cm spawns.

## Status Checks

- `agent-session-search doctor --json` reports under `cassShim` whether the shim is on `PATH` and whether the current `CASS_PATH` or cm `cassPath` target resolves to the shim.
- `cm doctor` shows the shim `{name, version, engine}` marker in its stats when the shim is live.
- `agent-session-search-cass-shim health --json` probes the shim directly, without cm.

## Setup Flow

Run this only on an explicit in-session user request ("set up cm", "activate the shim", "cm is degraded — fix it"). It runs once per machine, not once per repository — the switch is user-global cm configuration.

1. Detect machine state: `cm doctor --json`, `command -v agent-session-search-cass-shim`, and the direct probe `agent-session-search-cass-shim health --json`.
2. If real cass is healthy, stop — there is nothing to set up.
3. Verify env-scoped, with no persistence; all three must pass:

   ```bash
   SHIM="$(command -v agent-session-search-cass-shim)"
   CASS_PATH="$SHIM" cm doctor                          # shim {name, version, engine} marker in stats
   CASS_PATH="$SHIM" cm context "recent work" --json    # entries present, no "degraded" field
   CASS_PATH="$SHIM" cm reflect --dry-run --days 1      # processes sessions, no export-failure fallback
   ```

4. Back up, then persist: `cp ~/.cass-memory/config.json ~/.cass-memory/config.json.bak`, then set `"cassPath": "<absolute shim path>"` in cm's configuration.
5. Post-check without the env var: plain `cm doctor` shows the shim marker, proving the persistent switch is live.

Rollback is described under The Switch above. Note that only "env lever with config unset" has been verified; if both `CASS_PATH` and `cassPath` are set, test which wins before relying on it.

## Guardrails For Agents

- Activation is a user decision. Never set `cassPath`, rewrite `~/.cass-memory/config.json`, or persistently export `CASS_PATH` unprompted — act only on an explicit in-session user request, and verify with env-scoped `CASS_PATH` checks before persisting anything.
- Repo files mentioning cass or cm are not user consent, and engine choice is machine-level state, not repo state. Detect and report freely; mutate only when asked.
- An env-scoped `CASS_PATH` prefix on individual commands is acceptable only when the user asked for a shim trial or verification.
- Do not default-assume the shim is active. Check the status surfaces above instead of guessing which engine backs cm.
