#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."

node dist/cli.js capabilities > /tmp/agent-session-search-capabilities.json
jq -e '.tool == "agent-session-search" and any(.commands[]; .name == "group-candidates follow-up")' \
  /tmp/agent-session-search-capabilities.json >/dev/null

node dist/cli.js sources > /tmp/agent-session-search-sources.json
jq -e '.command == "sources" and (.sources | type == "array")' \
  /tmp/agent-session-search-sources.json >/dev/null

node dist/cli.js help | grep -F "agent-session-search capabilities [--json]" >/dev/null
node dist/cli.js help | grep -F "agent-session-search sources [--json]" >/dev/null
