#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."

node dist/cli.js --json --jsno 2>/tmp/agent-session-search-jsno.err >/tmp/agent-session-search-jsno.out && exit 1
test ! -s /tmp/agent-session-search-jsno.out
jq -e '.error.code == "user_input_error" and (.error.message | contains("--json")) and (.error.suggestedCommand | contains("--json"))' /tmp/agent-session-search-jsno.err >/dev/null

node dist/cli.js --jason "auth token timeout" 2>/tmp/agent-session-search-jason.err >/tmp/agent-session-search-jason.out && exit 1
test ! -s /tmp/agent-session-search-jason.out
grep -F "did you mean --json?" /tmp/agent-session-search-jason.err >/dev/null
grep -F "Suggested command: agent-session-search --json 'auth token timeout'" /tmp/agent-session-search-jason.err >/dev/null
