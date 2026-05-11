#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."
node dist/fff-preflight.js --help | grep -F "Usage: agent-session-search-doctor" >/dev/null

