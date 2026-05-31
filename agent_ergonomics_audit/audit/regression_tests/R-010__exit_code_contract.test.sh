#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."

node dist/cli.js capabilities --json \
  | jq -e '.exitCodes | map([.code, .meaning]) | contains([[0, "success"], [1, "user-input-error"], [3, "tool-environment-error"], [4, "upstream-failure"]])' >/dev/null

node dist/cli.js --json >/tmp/agent-session-search-json-parse.out 2>/tmp/agent-session-search-json-parse.err && exit 1
test $? -eq 1
test ! -s /tmp/agent-session-search-json-parse.out

empty_path="$(mktemp -d)"
node_bin="$(command -v node)"
PATH="$empty_path" "$node_bin" dist/fff-preflight.js >/tmp/agent-session-search-doctor-env.out 2>/tmp/agent-session-search-doctor-env.err && exit 1
test $? -eq 3
grep -F "fff-mcp was not found on PATH" /tmp/agent-session-search-doctor-env.err >/dev/null
