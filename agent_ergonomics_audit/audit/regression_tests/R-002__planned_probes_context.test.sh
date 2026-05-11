#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."
npx vitest run test/cli.test.ts --testNamePattern "planned probes"

