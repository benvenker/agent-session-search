#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_CM_VERSION="0.2.12"
readonly EXPECTED_CASS_VERSION="cass 0.6.22"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() {
  printf 'cm/cass contract verification failed: %s\n' "$1" >&2
  printf 'Re-verify the pinned contract and update %s/docs/cass-shim.md before accepting this drift.\n' "$REPO_ROOT" >&2
  exit 1
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || fail "required tool not found: $1"
}

resolve_executable() {
  local configured="$1"
  local fallback="$2"
  local resolved
  if [[ -n "$configured" ]]; then
    resolved="$configured"
  else
    resolved="$(command -v "$fallback" 2>/dev/null || true)"
  fi
  [[ -n "$resolved" && -x "$resolved" ]] || fail "executable not found: $fallback"
  printf '%s\n' "$resolved"
}

readonly PROBE_TIMEOUT="${VERIFY_CM_CONTRACT_TIMEOUT:-10}"
[[ "$PROBE_TIMEOUT" =~ ^[1-9][0-9]*$ ]] ||
  fail "VERIFY_CM_CONTRACT_TIMEOUT must be a positive integer"

require_tool jq
require_tool strings
require_tool timeout

readonly CM_BIN_RESOLVED="$(resolve_executable "${CM_BIN:-}" cm)"
readonly CASS_BIN_RESOLVED="$(resolve_executable "${CASS_BIN:-}" cass)"

if [[ -n "${CASS_SHIM_BIN:-}" ]]; then
  readonly CASS_SHIM_BIN_RESOLVED="$(resolve_executable "$CASS_SHIM_BIN" agent-session-search-cass-shim)"
elif [[ -x "$REPO_ROOT/dist/cass-shim.js" ]]; then
  readonly CASS_SHIM_BIN_RESOLVED="$REPO_ROOT/dist/cass-shim.js"
else
  readonly CASS_SHIM_BIN_RESOLVED="$(resolve_executable "" agent-session-search-cass-shim)"
fi

readonly CM_VERSION="$($CM_BIN_RESOLVED --version 2>/dev/null || true)"
[[ "$CM_VERSION" == "$EXPECTED_CM_VERSION" ]] ||
  fail "cm version drifted: expected '$EXPECTED_CM_VERSION', got '${CM_VERSION:-<empty>}'"

readonly CASS_VERSION="$($CASS_BIN_RESOLVED --version 2>/dev/null || true)"
[[ "$CASS_VERSION" == "$EXPECTED_CASS_VERSION" ]] ||
  fail "cass version drifted: expected '$EXPECTED_CASS_VERSION', got '${CASS_VERSION:-<empty>}'"

readonly WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/verify-cm-contract.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

readonly CM_STRINGS="$WORK_DIR/cm.strings"
strings "$CM_BIN_RESOLVED" >"$CM_STRINGS"

assert_cm_fact() {
  local label="$1"
  local fact="$2"
  grep -Fq -- "$fact" "$CM_STRINGS" || fail "$label drifted (missing extracted cm fact: $fact)"
}

# Static facts that cannot be observed from child argv alone.
assert_cm_fact "cm cassPath availability timeout" 'runner.spawnSync(resolved, ["--version"], { stdio: "pipe", timeout: 2000 })'
assert_cm_fact "cm search argv builder" 'const args = ["search"];'
assert_cm_fact "cm search --limit argv" 'args.push("--limit", options.limit.toString());'
assert_cm_fact "cm search --days argv" 'args.push("--days", options.days.toString());'
assert_cm_fact "cm repeated --agent argv" 'agents.forEach((a) => args.push("--agent", a));'
assert_cm_fact "cm search --workspace argv" 'args.push("--workspace", options.workspace);'
assert_cm_fact "cm search --fields argv" 'args.push("--fields", options.fields.join(","));'
assert_cm_fact "cm search --robot argv" 'args.push("--robot");'
assert_cm_fact "cm search separator argv" 'args.push("--");'
assert_cm_fact "cm search query argv" 'args.push(query);'
assert_cm_fact "cm hit line_number schema" 'line_number: exports_external.number(),'
assert_cm_fact "cm robot hits envelope" 'Array.isArray(rawHits.hits)'
assert_cm_fact "cm export UNKNOWN counter" 'const unknownCount = (stdout.match(/=== UNKNOWN ===/g) || []).length;'
assert_cm_fact "cm export UNKNOWN fallback heuristic" 'if (unknownRatio > 0.5 && unknownCount > 3) {'
assert_cm_fact "cm cass exit 3 reaction" 'INDEX_MISSING: 3,'
assert_cm_fact "cm cass exit 4 reaction" 'NOT_FOUND: 4,'
assert_cm_fact "cm cass exit 9 reaction" 'UNKNOWN: 9,'
assert_cm_fact "cm cass exit 10 reaction" 'TIMEOUT: 10'

readonly PROBE_CASS="$WORK_DIR/cass-contract-probe"
readonly PROBE_HOME="$WORK_DIR/home"
readonly PROBE_WORKSPACE="$WORK_DIR/workspace"
mkdir -p "$PROBE_HOME" "$PROBE_WORKSPACE"

cat >"$PROBE_CASS" <<'PROBE'
#!/usr/bin/env bash
set -euo pipefail
jq -cn --args '$ARGS.positional' -- "$@" >>"$CM_CONTRACT_ARGV_LOG"

if [[ "${1:-}" == "--version" ]]; then
  printf '%s\n' 'cass 0.6.22'
  exit 0
fi

if [[ "${1:-}" != "search" ]]; then
  exit 2
fi

if [[ "${CM_CONTRACT_SEARCH_EXIT:-0}" != "0" ]]; then
  exit "$CM_CONTRACT_SEARCH_EXIT"
fi

query="${!#}"
if [[ "${CM_CONTRACT_LINE_NUMBER_MODE:-number}" == "null" ]]; then
  line_number='null'
else
  line_number='1'
fi

jq -cn \
  --arg query "$query" \
  --argjson line_number "$line_number" \
  '{
    query: $query,
    limit: 1,
    offset: 0,
    count: 1,
    total_matches: 1,
    hits: [{
      source_path: "/tmp/cm-contract-probe.jsonl",
      line_number: $line_number,
      agent: "codex",
      snippet: "cm contract probe",
      score: 1
    }],
    max_tokens: null,
    request_id: null,
    cursor: null,
    hits_clamped: false
  }'
PROBE
chmod 755 "$PROBE_CASS"

run_cm_probe() {
  local label="$1"
  local query="$2"
  local expected_argv="$3"
  local assertion="$4"
  shift 4
  local log="$WORK_DIR/$label.argv.jsonl"
  local stdout="$WORK_DIR/$label.stdout.json"
  local stderr="$WORK_DIR/$label.stderr"
  : >"$log"

  if ! (
    cd "$PROBE_HOME"
    env \
      HOME="$PROBE_HOME" \
      CASS_PATH="$PROBE_CASS" \
      CM_CONTRACT_ARGV_LOG="$log" \
      CM_CONTRACT_LINE_NUMBER_MODE="${CM_CONTRACT_LINE_NUMBER_MODE:-number}" \
      CM_CONTRACT_SEARCH_EXIT="${CM_CONTRACT_SEARCH_EXIT:-0}" \
      timeout "${PROBE_TIMEOUT}s" "$CM_BIN_RESOLVED" context "$query" "$@" --json
  ) >"$stdout" 2>"$stderr"; then
    fail "$label cm probe did not complete: $(tr '\n' ' ' <"$stderr")"
  fi

  local actual_argv
  actual_argv="$(jq -cs '.' "$log")" || fail "$label produced an invalid argv log"
  if ! jq -en --argjson actual "$actual_argv" --argjson expected "$expected_argv" \
    '$actual == $expected' >/dev/null; then
    fail "cm search argv drifted for $label: expected $expected_argv, got $actual_argv"
  fi

  jq -e "$assertion" "$stdout" >/dev/null ||
    fail "$label cm consumption reaction drifted: $(tr '\n' ' ' <"$stdout")"
}

readonly DEFAULT_QUERY="cm-contract-default-probe"
readonly DEFAULT_ARGV="$(jq -cn --arg query "$DEFAULT_QUERY" '[
  ["--version"],
  ["search", "--limit", "10", "--days", "7", "--robot", "--", $query]
]')"
run_cm_probe \
  default \
  "$DEFAULT_QUERY" \
  "$DEFAULT_ARGV" \
  '(.data.historySnippets | length == 1) and (.data | has("degraded") | not)'

readonly EXPLICIT_QUERY="cm-contract-explicit-probe"
readonly EXPLICIT_ARGV="$(jq -cn --arg query "$EXPLICIT_QUERY" --arg workspace "$PROBE_WORKSPACE" '[
  ["--version"],
  ["search", "--limit", "3", "--days", "11", "--workspace", $workspace, "--robot", "--", $query]
]')"
run_cm_probe \
  explicit \
  "$EXPLICIT_QUERY" \
  "$EXPLICIT_ARGV" \
  '(.data.historySnippets | length == 1) and (.data | has("degraded") | not)' \
  --history 3 --days 11 --workspace "$PROBE_WORKSPACE"

readonly NULL_QUERY="cm-contract-null-line-probe"
readonly NULL_ARGV="$(jq -cn --arg query "$NULL_QUERY" '[
  ["--version"],
  ["search", "--limit", "10", "--days", "7", "--robot", "--", $query]
]')"
CM_CONTRACT_LINE_NUMBER_MODE=null run_cm_probe \
  null-line \
  "$NULL_QUERY" \
  "$NULL_ARGV" \
  '(.data.historySnippets | length == 0) and (.data.degraded.cass.reason == "OTHER")'

probe_exit_reaction() {
  local code="$1"
  local reason="$2"
  local query="cm-contract-exit-$code-probe"
  local expected
  expected="$(jq -cn --arg query "$query" '[
    ["--version"],
    ["search", "--limit", "10", "--days", "7", "--robot", "--", $query]
  ]')"
  local assertion
  if [[ -n "$reason" ]]; then
    assertion="(.data.historySnippets | length == 0) and (.data.degraded.cass.reason == \"$reason\")"
  else
    assertion='(.data.historySnippets | length == 0) and (.data | has("degraded") | not)'
  fi
  CM_CONTRACT_SEARCH_EXIT="$code" run_cm_probe "exit-$code" "$query" "$expected" "$assertion"
}

probe_exit_reaction 3 INDEX_MISSING
probe_exit_reaction 4 ""
probe_exit_reaction 9 OTHER
probe_exit_reaction 10 TIMEOUT

readonly SHIM_VERSION="$($CASS_SHIM_BIN_RESOLVED --version 2>/dev/null || true)"
[[ "$SHIM_VERSION" == agent-session-search-cass-shim* ]] ||
  fail "shim --version identity drifted: got '${SHIM_VERSION:-<empty>}'"

readonly SHIM_QUERY="${VERIFY_CM_CONTRACT_QUERY:-vitest}"
readonly SHIM_SEARCH_OUT="$WORK_DIR/shim-search.json"
readonly SHIM_SEARCH_ERR="$WORK_DIR/shim-search.stderr"
if ! timeout "${PROBE_TIMEOUT}s" "$CASS_SHIM_BIN_RESOLVED" \
  search --limit 1 --agent codex --robot -- "$SHIM_QUERY" \
  >"$SHIM_SEARCH_OUT" 2>"$SHIM_SEARCH_ERR"; then
  fail "shim robot search failed: $(tr '\n' ' ' <"$SHIM_SEARCH_ERR")"
fi

jq -e '
  (keys | sort) == ([
    "query", "limit", "offset", "count", "total_matches", "hits",
    "max_tokens", "request_id", "cursor", "hits_clamped"
  ] | sort)
  and (.count == (.hits | length))
  and (.count >= 1)
  and all(.hits[];
    (.title | type == "string") and
    (.snippet | type == "string") and
    (.content == .snippet) and
    (.score | type == "number") and
    (.source_path | type == "string") and
    (.agent | type == "string") and
    (.line_number | type == "number") and
    (.match_type | type == "string") and
    (.source_id | type == "string") and
    (.origin_kind | type == "string")
  )
' "$SHIM_SEARCH_OUT" >/dev/null ||
  fail "shim --robot envelope or hit schema drifted"

readonly SHIM_UNSUPPORTED_OUT="$WORK_DIR/shim-unsupported.json"
readonly SHIM_UNSUPPORTED_ERR="$WORK_DIR/shim-unsupported.stderr"
if ! timeout "${PROBE_TIMEOUT}s" "$CASS_SHIM_BIN_RESOLVED" \
  search --limit 1 --agent claude --robot -- "$SHIM_QUERY" \
  >"$SHIM_UNSUPPORTED_OUT" 2>"$SHIM_UNSUPPORTED_ERR"; then
  fail "shim unsupported-agent probe did not remain exit zero"
fi
jq -e '.count == 0 and .hits == []' "$SHIM_UNSUPPORTED_OUT" >/dev/null ||
  fail "shim unsupported agent broadened instead of returning zero hits"
grep -Fxq \
  'Unsupported agent slug claude. Accepted agent slugs: claude_code, codex, cursor, gemini, hermes, pi_agent.' \
  "$SHIM_UNSUPPORTED_ERR" ||
  fail "shim agent-slug allowlist drifted (expected claude_code, not claude)"

readonly EXPORT_FIXTURE="${CASS_SHIM_EXPORT_FIXTURE:-$REPO_ROOT/test/fixtures/cass-compat/claude-session.jsonl}"
[[ -f "$EXPORT_FIXTURE" ]] || fail "export fixture not found: $EXPORT_FIXTURE"
readonly SHIM_EXPORT_OUT="$WORK_DIR/shim-export.txt"
readonly SHIM_EXPORT_ERR="$WORK_DIR/shim-export.stderr"
if ! timeout "${PROBE_TIMEOUT}s" "$CASS_SHIM_BIN_RESOLVED" \
  export --format text -- "$EXPORT_FIXTURE" \
  >"$SHIM_EXPORT_OUT" 2>"$SHIM_EXPORT_ERR"; then
  fail "shim export probe failed: $(tr '\n' ' ' <"$SHIM_EXPORT_ERR")"
fi
[[ -s "$SHIM_EXPORT_OUT" ]] || fail "shim export probe returned empty output"
if grep -Fq '=== UNKNOWN ===' "$SHIM_EXPORT_OUT"; then
  fail "shim export emitted UNKNOWN role blocks"
fi

printf 'cm/cass contract verified: cm %s, %s, exact argv and consumer reactions intact\n' \
  "$CM_VERSION" "$CASS_VERSION"
