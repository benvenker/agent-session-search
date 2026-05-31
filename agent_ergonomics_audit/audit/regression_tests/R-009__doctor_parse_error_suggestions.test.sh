#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."

node dist/fff-preflight.js --wat 2>/tmp/agent-session-search-doctor-wat.err >/tmp/agent-session-search-doctor-wat.out && exit 1
test ! -s /tmp/agent-session-search-doctor-wat.out
grep -F "Unknown option: --wat" /tmp/agent-session-search-doctor-wat.err >/dev/null
grep -F "Usage: agent-session-search-doctor" /tmp/agent-session-search-doctor-wat.err >/dev/null
grep -F "Suggested command: agent-session-search-doctor help" /tmp/agent-session-search-doctor-wat.err >/dev/null

node dist/fff-preflight.js --skip-smok 2>/tmp/agent-session-search-doctor-skip-smok.err >/tmp/agent-session-search-doctor-skip-smok.out && exit 1
test ! -s /tmp/agent-session-search-doctor-skip-smok.out
grep -F "did you mean --skip-smoke?" /tmp/agent-session-search-doctor-skip-smok.err >/dev/null
grep -F "Suggested command: agent-session-search-doctor --skip-smoke" /tmp/agent-session-search-doctor-skip-smok.err >/dev/null

node dist/fff-preflight.js --command 2>/tmp/agent-session-search-doctor-command.err >/tmp/agent-session-search-doctor-command.out && exit 1
test ! -s /tmp/agent-session-search-doctor-command.out
grep -F -- "--command requires a value" /tmp/agent-session-search-doctor-command.err >/dev/null
grep -F "Usage: agent-session-search-doctor" /tmp/agent-session-search-doctor-command.err >/dev/null
