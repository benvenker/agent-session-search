#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."
node dist/cli.js capabilities --json | jq -e '.tool == "agent-session-search" and .mcp.tools[0].name == "search_sessions"' >/dev/null
node dist/cli.js --robot-triage | jq -e '.quickRef.mcpTool == "search_sessions"' >/dev/null
node dist/cli.js robot-docs guide | grep -F "Agent guide: agent-session-search" >/dev/null

