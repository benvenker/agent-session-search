#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."

tmp_dir="$(mktemp -d)"

printf '{"query":"auth token timeout","sources":["codex"],"resultsDisplayMode":"candidates","planFingerprint":"gcp1:test","fingerprint":"gcf1:edited","group":{"id":"exact_or_structured","priority":0,"patternIds":["p1"]},"offset":0,"limit":5}' \
  > "$tmp_dir/invalid-group.json"

node dist/cli.js --json --group-candidates "@$tmp_dir/invalid-group.json" \
  > "$tmp_dir/stdout.json" 2> "$tmp_dir/stderr.json" && exit 1

test ! -s "$tmp_dir/stdout.json"
jq -e '.error.code == "invalid_group_followup"' "$tmp_dir/stderr.json" >/dev/null
jq -e '.error.invalidField == "groupCandidates.fingerprint"' "$tmp_dir/stderr.json" >/dev/null
jq -e '.error.correctedShape.groupCandidates.fingerprint == "<server-prepared fingerprint>"' "$tmp_dir/stderr.json" >/dev/null
jq -e '.error.suggestedCommand | contains("agent-session-search --json --group-candidates @payload.json")' "$tmp_dir/stderr.json" >/dev/null
