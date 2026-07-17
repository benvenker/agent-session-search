# Draft: GitHub issue for smithersai/smithers

**Proposed title:** KimiAgent is incompatible with kimi-code 0.26 (Rust CLI contract): hardcoded kimi-cli-style flags fail at spawn, and there is no MCP registration path

**Labels (suggested):** bug, agents, kimi

---

## Summary

`KimiAgent` (smithers-orchestrator 0.23.0) appears to target the flag
surface of the `kimi-cli` 1.x-style contract (the contract its docs and
comments assume). The vendor's actively distributed `kimi-code`
binary (Rust, currently 0.26.0) exposes a **different CLI contract**. Every
KimiAgent task spawned against a current kimi-code install fails immediately
with `unknown option` errors, and KimiAgent's MCP registration flags
(`--mcp-config-file`, `--mcp-config`) have no equivalent at all — kimi-code
discovers MCP servers only from a project-scoped `.mcp.json`.

This is not a staleness issue: the affected machine is on the **latest**
kimi-code (0.26.0), confirmed by the vendor's own update channel
(`~/.kimi-code/updates/latest.json` → `"latest": "0.26.0"`, published
2026-07-16). Both distributions are actively maintained side by side:
`kimi-cli` 1.49.0 on PyPI (the 1.x-style contract KimiAgent appears to
assume) and kimi-code 0.26.0 (Rust). They share the binary name `kimi`
but not the flag surface.

## Observed failures (all reproducible)

1. **Spawn fails on the very first flag.** KimiAgent pushes `--print`
   (`KimiAgent.js`: "Print mode is required for non-interactive execution").
   kimi-code 0.26 exits with:

   ```
   error: unknown option '--print' (Did you mean --prompt?)
   ```

   In a Smithers run the task retried indefinitely (attempts 1–9 observed)
   because the failure is classified retryable. An `unknown option` exit
   should be a fail-fast configuration error.

2. **More unknown options** once `--print` is removed:
   `--final-message-only`, `--thinking`, `--work-dir`,
   `--mcp-config-file`, `--mcp-config` are all rejected.

3. **`--session <fresh-uuid>` fails.** KimiAgent always passes a generated
   UUID (`resumeSession ?? opts.session ?? randomUUID()`). kimi-code 0.26's
   `-S/--session [id]` only _resumes_ existing sessions:
   `error: failed to run prompt: Session "<uuid>" not found.`

4. **Yolo semantics diverge.** Upstream `--print` implicitly enables yolo
   (per the KimiAgent comment). kimi-code 0.26 instead _rejects_ the
   combination: `error: Cannot combine --prompt with --yolo.`

5. **No MCP path.** KimiAgent offers `mcpConfigFile`/`mcpConfig`; kimi-code
   0.26 has no MCP CLI flags. Empirically, 0.26 discovers MCP servers only
   from a project-scoped `.mcp.json` in the working directory:
   - With `[mcp_servers.*]` tables added to `$KIMI_SHARE_DIR/config.toml`,
     the agent reported it could see no such servers ("The .mcp.json only
     registers smithers").
   - After merging the same server entries into `<cwd>/.mcp.json`, the agent
     discovered and successfully called the tools.

## Flag contract matrix

| KimiAgent emits (0.23.0)                                                   | kimi-code 0.26.0                              | Notes                                |
| -------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------ |
| `--print`                                                                  | ✗ (use `-p, --prompt <prompt>`)               | `-p` alone is non-interactive        |
| `--prompt <text>`                                                          | ✓ `-p, --prompt`                              |                                      |
| `--output-format text\|stream-json`                                        | ✓ `--output-format`                           | text default                         |
| `--final-message-only`                                                     | ✗                                             | no equivalent flag                   |
| `--work-dir <dir>`                                                         | ✗                                             | spawn `cwd` already applies          |
| `--session <uuid>`                                                         | ✗ (`-S` resume-only)                          | fresh UUID errors "not found"        |
| `--thinking` / `--no-thinking`                                             | ✗                                             | model config lists `always_thinking` |
| `--quiet`                                                                  | ✗                                             |                                      |
| `--model <m>`                                                              | ✓ `-m, --model`                               |                                      |
| `--skills-dir <dir>`                                                       | ✓ `--skills-dir`                              |                                      |
| `--agent`, `--agent-file`                                                  | ✗                                             |                                      |
| `--mcp-config-file`, `--mcp-config`                                        | ✗                                             | project `.mcp.json` only             |
| `--max-steps-per-turn`, `--max-retries-per-step`, `--max-ralph-iterations` | ✗                                             |                                      |
| `--verbose`, `--debug`                                                     | ?                                             | untested                             |
| `--continue`                                                               | ✓ `-c`                                        |                                      |
| —                                                                          | `-y, --yolo`, `--auto`, `--add-dir`, `--plan` | kimi-code-only                       |
| —                                                                          | `Cannot combine --prompt with --yolo`         | semantic divergence                  |

kimi-code 0.26.0 subcommands (for context): `export`, `provider`, `acp`,
`server`, `web`, `login`, `doctor`, `vis`, `migrate` ("Migrate data from a
legacy kimi-cli installation"), `upgrade`.

## Root cause

`KimiAgent.js` builds its argv against one fixed, kimi-cli-style contract.
The vendor now ships two divergent contracts under the same binary name
(`kimi-cli` 1.x on PyPI vs `kimi-code` 0.x). `[mcp_servers]` support
exists in the binary but is not consulted for discovery in 0.26; the
project `.mcp.json` file is.

## Suggested fix directions

1. **Contract detection.** At spawn, detect which product `kimi` is
   (`kimi --version` banner, `--help` surface, or presence of
   `~/.kimi-code/` artifacts) and select a flag profile per product line.
2. **Per-profile argv.** For kimi-code: drop `--print`,
   `--final-message-only`, `--thinking`, `--quiet`, agent/max-\* flags;
   translate `--work-dir` to spawn cwd; do not pass a fresh `--session`
   UUID (or create-then-resume); do not combine `--prompt` with `--yolo`.
3. **Per-profile MCP.** For kimi-code, register servers by merging into the
   task cwd's `.mcp.json` (preserving existing entries, restoring after the
   run) instead of `--mcp-config-file`.
4. **Fail fast on contract errors.** Classify `unknown option` /
   `Session ... not found` as non-retryable configuration errors so the
   run surfaces the mismatch on attempt 1 instead of looping.
5. **Optional escape hatch.** A documented argv/env transform hook on
   `BaseCliAgent` would let users absorb future CLI drift without forking
   the adapter.

## Reference workaround (input to the fix, not the proposed shape)

We run the following bash shim earlier on `PATH` so `KimiAgent`'s `kimi`
spawn resolves to it. It implements the translations above (plus
`.mcp.json` merge/restore) and has been used successfully as a local
workaround in this repo's evaluation runs with Smithers 0.23.0 +
kimi-code 0.26.0 — including a four-model live-MCP evaluation in which
the kimi evaluator called registered tools successfully. Offered as
evidence that a small, mechanical translation layer is sufficient; the
durable fix should live in the adapter in TypeScript, not in a
PATH-shadowing shell wrapper (bash-only, PATH-ordering fragile, no
Windows story).

```bash
#!/usr/bin/env bash
# kimi shim: translate upstream kimi CLI flags to kimi-code 0.26.x.
set -euo pipefail

out=()
workdir=""
mcp_inputs=()
while (($#)); do
  case "$1" in
    --print | --final-message-only | --thinking | --no-thinking)
      shift
      ;;
    --mcp-config-file | --mcp-config)
      mcp_inputs+=("$2")
      shift 2
      ;;
    --work-dir)
      workdir="${2:-}"
      shift 2
      ;;
    --session)
      # 0.26 --session only resumes existing sessions; Smithers always
      # passes a fresh UUID, which errors. Drop it.
      shift 2
      ;;
    *)
      out+=("$1")
      shift
      ;;
  esac
done

if [[ -n "$workdir" ]]; then
  cd "$workdir"
fi

mcp_json=""
backup=""
if ((${#mcp_inputs[@]})); then
  mcp_json="$PWD/.mcp.json"
  if [[ -f "$mcp_json" ]]; then
    backup="$(mktemp)"
    cp "$mcp_json" "$backup"
  fi
  python3 - "$mcp_json" "${mcp_inputs[@]}" <<'PY'
import json, sys
path, *inputs = sys.argv[1:]
try:
    base = json.load(open(path))
except Exception:
    base = {}
servers = base.setdefault("mcpServers", {})
for item in inputs:
    data = json.loads(item) if item.lstrip().startswith("{") else json.load(open(item))
    servers.update(data.get("mcpServers", data))
json.dump(base, open(path, "w"), indent=2)
PY
fi

rc=0
/home/ben/.kimi-code/bin/kimi "${out[@]}" || rc=$?

if [[ -n "$mcp_json" ]]; then
  if [[ -n "$backup" ]]; then
    cp "$backup" "$mcp_json" && rm -f "$backup"
  else
    rm -f "$mcp_json"
  fi
fi
exit "$rc"
```

(The production copy additionally execs the resolved real binary path;
`--mcp-config` inline JSON and `--mcp-config-file` paths are both accepted
and normalized into the `.mcp.json` `mcpServers` object.)

## Environment

- smithers-orchestrator 0.23.0 (`@smithers-orchestrator/agents/src/KimiAgent.js`)
- kimi-code 0.26.0 (ELF x86-64; latest per vendor channel 2026-07-17)
- PyPI `kimi-cli` 1.49.0 present as the parallel 1.x distribution
- Linux x86_64, bash/zsh

## Reproduction

```bash
# With kimi-code 0.26.0 as `kimi` on PATH:
kimi --print --output-format text --model kimi-code/k3 --prompt "hi"
# -> error: unknown option '--print' (Did you mean --prompt?)

kimi --mcp-config-file ./mcp.json --prompt "hi"
# -> error: unknown option '--mcp-config-file'

kimi --session 11111111-2222-3333-4444-555555555555 --prompt "hi"
# -> error: failed to run prompt: Session "11111111-..." not found.
```
