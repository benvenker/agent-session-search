#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."

fff-mcp --version | grep -F "fff-mcp 0.9.5" >/dev/null
node dist/fff-preflight.js --skip-smoke >/dev/null

rg -n "v0\\.9\\.5|0\\.9\\.5" src/fff-preflight.ts scripts/postinstall.mjs README.md docs/troubleshooting.md test/fff-preflight.test.ts test/packaging.test.ts >/dev/null
if rg -n "0\\.9\\.4" src scripts README.md docs test package.json >/dev/null; then
  exit 1
fi
