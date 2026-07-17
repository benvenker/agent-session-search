#!/usr/bin/env bash
# Validate DCG (Destructive Command Guard) is installed and active for this project.
set -euo pipefail

echo "=== DCG validation ==="

if ! command -v dcg &> /dev/null; then
    echo "ERROR: dcg not found in PATH"
    echo "Install from: https://github.com/Dicklesworthstone/destructive_command_guard"
    exit 1
fi
echo "✓ dcg binary found: $(command -v dcg)"

if ! dcg doctor &> /dev/null; then
    echo "ERROR: dcg doctor failed — hook may not be registered. Run: dcg install"
    exit 1
fi
echo "✓ dcg doctor passed (hook registered)"

if [ -f ".dcg.toml" ]; then
    echo "✓ Project config found: .dcg.toml"
else
    echo "○ No project config (.dcg.toml)"
fi

# Smoke tests: destructive commands should be blocked, safe commands allowed.
test_command() {
    local cmd="$1"
    local expected="$2"
    local result

    if dcg test "$cmd" &> /dev/null; then
        result="allow"
    else
        result="block"
    fi

    if [ "$result" = "$expected" ]; then
        echo "✓ '$cmd' → $result"
    else
        echo "✗ '$cmd' → $result (expected: $expected)"
        return 1
    fi
}

# Should be blocked
test_command "rm -rf /" "block"
test_command "rm -rf ./build" "block"
test_command "git reset --hard HEAD" "block"

# Should be blocked (project-specific pack: platform.github)
test_command "gh repo delete owner/repo --yes" "block"

# Should be allowed
test_command "git status" "allow"
test_command "ls -la" "allow"

echo "=== DCG validation complete ==="
