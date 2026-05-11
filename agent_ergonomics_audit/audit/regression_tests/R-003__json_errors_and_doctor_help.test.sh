#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."
node dist/cli.js --json 2>/tmp/agent-session-search-json-error.err >/tmp/agent-session-search-json-error.out && exit 1
test ! -s /tmp/agent-session-search-json-error.out
jq -e '.error.code == "user_input_error"' /tmp/agent-session-search-json-error.err >/dev/null
node dist/fff-preflight.js --help | grep -F "Usage: agent-session-search-doctor" >/dev/null

