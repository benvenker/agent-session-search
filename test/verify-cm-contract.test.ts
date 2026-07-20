import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const verifier = resolve("scripts/verify-cm-contract.sh");

describe("cm/cass contract drift verifier", () => {
  it("accepts matching versions, extracted facts, and exact cm-emitted argv", async () => {
    const fixture = await createFixture();
    const result = await runVerifier(fixture);

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("cm/cass contract verified");
  });

  it("fails loudly when cm changes its emitted search argv", async () => {
    const fixture = await createFixture();

    await expect(
      runVerifier(fixture, { FAKE_CM_DRIFT: "1" })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("cm search argv drifted"),
    });
  });

  it("rejects a zero probe timeout instead of disabling the bound", async () => {
    const fixture = await createFixture();

    await expect(
      runVerifier(fixture, { VERIFY_CM_CONTRACT_TIMEOUT: "0" })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "VERIFY_CM_CONTRACT_TIMEOUT must be a positive integer"
      ),
    });
  });
});

type Fixture = {
  cm: string;
  cass: string;
  shim: string;
  exportFixture: string;
};

async function runVerifier(fixture: Fixture, extraEnv: NodeJS.ProcessEnv = {}) {
  return execFileAsync(verifier, {
    cwd: resolve("."),
    env: {
      ...process.env,
      CM_BIN: fixture.cm,
      CASS_BIN: fixture.cass,
      CASS_SHIM_BIN: fixture.shim,
      CASS_SHIM_EXPORT_FIXTURE: fixture.exportFixture,
      VERIFY_CM_CONTRACT_QUERY: "contract-fixture",
      ...extraEnv,
    },
  });
}

async function createFixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "verify-cm-contract-"));
  const cm = join(directory, "cm");
  const cass = join(directory, "cass");
  const shim = join(directory, "cass-shim");
  const exportFixture = join(directory, "session.jsonl");

  await Promise.all([
    writeExecutable(cm, fakeCm),
    writeExecutable(cass, fakeCass),
    writeExecutable(shim, fakeShim),
    writeFile(
      exportFixture,
      '{"type":"user","message":{"content":"contract fixture"}}\n'
    ),
  ]);
  return { cm, cass, shim, exportFixture };
}

async function writeExecutable(path: string, contents: string) {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

const fakeCass = `#!/bin/sh
if [ "\${1-}" = "--version" ]; then
  printf '%s\\n' 'cass 0.6.22'
  exit 0
fi
exit 2
`;

const fakeShim = `#!/bin/sh
if [ "\${1-}" = "--version" ]; then
  printf '%s\\n' 'agent-session-search-cass-shim 0.1.0'
  exit 0
fi
if [ "\${1-}" = "export" ]; then
  printf '%s\\n' '=== USER ===' 'contract fixture'
  exit 0
fi
if [ "\${1-}" = "search" ]; then
  agent=''
  query='contract-fixture'
  while [ "\$#" -gt 0 ]; do
    if [ "\$1" = "--agent" ]; then
      agent="\$2"
      shift 2
      continue
    fi
    if [ "\$1" = "--" ]; then
      query="\$2"
      break
    fi
    shift
  done
  if [ "\$agent" != 'codex' ]; then
    printf '%s\\n' '{"query":"contract-fixture","limit":1,"offset":0,"count":0,"total_matches":0,"hits":[],"max_tokens":null,"request_id":null,"cursor":null,"hits_clamped":false}'
    printf '%s\\n' 'Unsupported agent slug claude. Accepted agent slugs: claude_code, codex, cursor, gemini, hermes, pi_agent.' >&2
    exit 0
  fi
  printf '%s\\n' "{\\"query\\":\\"\$query\\",\\"limit\\":1,\\"offset\\":0,\\"count\\":1,\\"total_matches\\":1,\\"hits\\":[{\\"title\\":\\"fixture\\",\\"snippet\\":\\"contract fixture\\",\\"content\\":\\"contract fixture\\",\\"score\\":1,\\"source_path\\":\\"/tmp/fixture.jsonl\\",\\"agent\\":\\"codex\\",\\"line_number\\":1,\\"match_type\\":\\"local\\",\\"source_id\\":\\"local\\",\\"origin_kind\\":\\"local\\"}],\\"max_tokens\\":null,\\"request_id\\":null,\\"cursor\\":null,\\"hits_clamped\\":false}"
  exit 0
fi
exit 2
`;

const fakeCm = `#!/bin/sh
# Pinned strings extracted from cm 0.2.12:
# runner.spawnSync(resolved, ["--version"], { stdio: "pipe", timeout: 2000 });
# const args = ["search"];
# args.push("--limit", options.limit.toString());
# args.push("--days", options.days.toString());
# agents.forEach((a) => args.push("--agent", a));
# args.push("--workspace", options.workspace);
# args.push("--fields", options.fields.join(","));
# args.push("--robot");
# args.push("--");
# args.push(query);
# line_number: exports_external.number(),
# Array.isArray(rawHits.hits)
# const unknownCount = (stdout.match(/=== UNKNOWN ===/g) || []).length;
# if (unknownRatio > 0.5 && unknownCount > 3) {
# INDEX_MISSING: 3,
# NOT_FOUND: 4,
# UNKNOWN: 9,
# TIMEOUT: 10
if [ "\${1-}" = "--version" ]; then
  printf '%s\\n' '0.2.12'
  exit 0
fi
if [ "\${1-}" != "context" ]; then
  exit 2
fi
query="\$2"
shift 2
limit=10
days=7
workspace=''
while [ "\$#" -gt 0 ]; do
  case "\$1" in
    --history) limit="\$2"; shift 2 ;;
    --days) days="\$2"; shift 2 ;;
    --workspace) workspace="\$2"; shift 2 ;;
    --json) shift ;;
    *) shift ;;
  esac
done
"\$CASS_PATH" --version >/dev/null 2>&1 || {
  printf '%s\\n' '{"success":true,"command":"context","data":{"historySnippets":[],"degraded":{"cass":{"reason":"NOT_FOUND"}}}}'
  exit 0
}
set -- search --limit "\$limit" --days "\$days"
if [ -n "\$workspace" ]; then
  set -- "\$@" --workspace "\$workspace"
fi
if [ "\${FAKE_CM_DRIFT-}" != '1' ]; then
  set -- "\$@" --robot
fi
set -- "\$@" -- "\$query"
set +e
search_output="\$("\$CASS_PATH" "\$@" 2>/dev/null)"
status=\$?
set -e
if [ "\$status" -eq 3 ]; then
  printf '%s\\n' '{"success":true,"command":"context","data":{"historySnippets":[],"degraded":{"cass":{"reason":"INDEX_MISSING"}}}}'
elif [ "\$status" -eq 4 ]; then
  printf '%s\\n' '{"success":true,"command":"context","data":{"historySnippets":[]}}'
elif [ "\$status" -eq 10 ]; then
  printf '%s\\n' '{"success":true,"command":"context","data":{"historySnippets":[],"degraded":{"cass":{"reason":"TIMEOUT"}}}}'
elif [ "\$status" -ne 0 ]; then
  printf '%s\\n' '{"success":true,"command":"context","data":{"historySnippets":[],"degraded":{"cass":{"reason":"OTHER"}}}}'
elif printf '%s' "\$search_output" | jq -e '.hits[0].line_number | type == "number"' >/dev/null 2>&1; then
  printf '%s\\n' '{"success":true,"command":"context","data":{"historySnippets":[{"snippet":"contract fixture"}]}}'
else
  printf '%s\\n' '{"success":true,"command":"context","data":{"historySnippets":[],"degraded":{"cass":{"reason":"OTHER"}}}}'
fi
`;
