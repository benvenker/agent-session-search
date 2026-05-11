#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."
npx vitest run test/search.test.ts --testNamePattern "requested sources do not select"
