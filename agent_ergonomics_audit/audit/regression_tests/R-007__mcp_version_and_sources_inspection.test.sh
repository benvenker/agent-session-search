#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."
npx vitest run test/mcp-smoke.test.ts test/cli.test.ts --testNamePattern "server version|configured source roots|machine-readable capabilities"
node dist/cli.js sources --json | jq -e '.command == "sources" and (.sources | type == "array") and (.warnings | type == "array")' >/dev/null
