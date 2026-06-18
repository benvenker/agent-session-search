#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."

tmp_dir="$(mktemp -d)"

node dist/cli.js "auth token timeout" --mode canddiates --json \
  > "$tmp_dir/mode.out" 2> "$tmp_dir/mode.err" && exit 1

test ! -s "$tmp_dir/mode.out"
jq -e '.error.code == "user_input_error"' "$tmp_dir/mode.err" >/dev/null
jq -e '.error.message | contains("did you mean candidates")' "$tmp_dir/mode.err" >/dev/null
jq -e '.error.suggestedCommand == "agent-session-search '\''auth token timeout'\'' --mode candidates --json"' "$tmp_dir/mode.err" >/dev/null

mkdir -p "$tmp_dir/codex"
printf 'auth token timeout candidate 1\n' > "$tmp_dir/codex/session-1.jsonl"
printf 'auth token timeout candidate 2\n' > "$tmp_dir/codex/session-2.jsonl"
printf 'auth token timeout candidate 3\n' > "$tmp_dir/codex/session-3.jsonl"
printf '{"roots":[{"name":"codex","path":"%s","include":["*.jsonl"]}]}' "$tmp_dir/codex" > "$tmp_dir/config.json"

AGENT_SESSION_SEARCH_CONFIG="$tmp_dir/config.json" \
  node dist/cli.js "auth token timeout" --json --source codex --max-results 1 \
  > "$tmp_dir/search.json"
jq '.results[0].more.groupCandidates' "$tmp_dir/search.json" > "$tmp_dir/group.json"
jq -e 'type == "object"' "$tmp_dir/group.json" >/dev/null

node dist/cli.js --json --group-candidates "@$tmp_dir/group.json" --source codex \
  > "$tmp_dir/mixed.out" 2> "$tmp_dir/mixed.err" && exit 1

test ! -s "$tmp_dir/mixed.out"
jq -e '.error.code == "user_input_error"' "$tmp_dir/mixed.err" >/dev/null
jq -e '.error.message | contains("--group-candidates is a complete server-prepared payload")' "$tmp_dir/mixed.err" >/dev/null
jq -e '.error.message | contains("--source")' "$tmp_dir/mixed.err" >/dev/null
