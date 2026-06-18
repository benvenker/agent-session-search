#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."

tmp_dir="$(mktemp -d)"
mkdir -p "$tmp_dir/codex"
for n in 1 2 3 4 5 6; do
  printf 'auth token timeout candidate %s\n' "$n" > "$tmp_dir/codex/session-$n.jsonl"
done
printf '{"roots":[{"name":"codex","path":"%s","include":["*.jsonl"]}]}' "$tmp_dir/codex" > "$tmp_dir/config.json"

AGENT_SESSION_SEARCH_CONFIG="$tmp_dir/config.json" \
  node dist/cli.js "auth token timeout" --json --source codex --max-results 2 \
  > "$tmp_dir/first.json"

jq -e '.resultsShape == "candidate_groups"' "$tmp_dir/first.json" >/dev/null
jq -e '.results[0].hasMore == true and .results[0].shownLeadCount == 2' "$tmp_dir/first.json" >/dev/null
jq '.results[0].more.groupCandidates' "$tmp_dir/first.json" > "$tmp_dir/group.json"

AGENT_SESSION_SEARCH_CONFIG="$tmp_dir/config.json" \
  node dist/cli.js --json --group-candidates "@$tmp_dir/group.json" \
  > "$tmp_dir/followup.json"

jq -e '.resultsShape == "candidate_groups"' "$tmp_dir/followup.json" >/dev/null
jq -e '.results[0].id == "exact_or_structured" and .results[0].shownLeadCount == 2' "$tmp_dir/followup.json" >/dev/null
jq -e '.results[0].more.groupCandidates.offset == 4' "$tmp_dir/followup.json" >/dev/null

printf '{"query":"auth token timeout","sources":["codex"],"resultsDisplayMode":"candidates","planFingerprint":"gcp1:test","fingerprint":"gcf1:edited","group":{"id":"exact_or_structured","priority":0,"patternIds":["p1"]},"offset":0,"limit":5}' \
  > "$tmp_dir/invalid-group.json"

node dist/cli.js --json --group-candidates "@$tmp_dir/invalid-group.json" \
  > "$tmp_dir/invalid.out" 2> "$tmp_dir/invalid.err" && exit 1

test ! -s "$tmp_dir/invalid.out"
jq -e '.error.code == "invalid_group_followup" and .error.invalidField == "groupCandidates.fingerprint"' "$tmp_dir/invalid.err" >/dev/null
jq -e '.error.suggestedCommand | contains("--group-candidates @payload.json")' "$tmp_dir/invalid.err" >/dev/null
