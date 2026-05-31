# Source Coverage Gap Decision

Date: 2026-05-31
Bead: `bd-3tv.4`

Status: implemented on `main`. The built-in `codex` source is now rooted at `~/.codex` with include patterns for top-level and nested files under both `sessions/` and `archived_sessions/`; see `src/roots.ts` and `test/root-resolver.test.ts`. The earlier "effective product configuration" section remains as investigation evidence from before the change.

## Question

Two known-answer sessions are searchable through CASS but are not available to
the configured live FFF roots used by `agent-session-search`. This pass checks
whether that is a product bug, a local configuration issue, an archive/source
coverage issue, or a broken CASS index.

Known session IDs:

- `019e3f4c-81e2-75a0-a125-8ea2ea42dd9f`
- `019e421a-f5fb-73b3-9d32-41f99f621639`

## Decision

The misses are source-coverage misses. The expected files are absent from the
configured live Codex root and present under Codex's archive root:
`/home/ben/.codex/archived_sessions`.

Do not change ranking to compensate. Do not add CASS integration, a derived
store, archive indexing, embeddings, or markdown exports. The recommended path
is to keep the FFF source-root model and extend the built-in `codex` root to
cover both live Codex sessions and Codex-managed archived sessions.

Follow-up implementation on 2026-05-31 superseded the config-only conclusion:
CM and CASS evidence showed `~/.codex/archived_sessions` is normal Codex storage
on this machine, so the built-in `codex` source should cover both live sessions
and archived sessions with precise include patterns.

## Effective Product Configuration

Command:

```bash
printf 'AGENT_SESSION_SEARCH_CONFIG=%s\n' "${AGENT_SESSION_SEARCH_CONFIG-}"
npm run dev:cli -- sources --json
```

Observed:

- `AGENT_SESSION_SEARCH_CONFIG` was unset.
- Default config path was `/home/ben/.config/agent-session-search/config.json`.
- The default config file was absent.
- Effective `codex` root was `/home/ben/.codex/sessions`.
- Effective `codex` include was `["*.jsonl"]`.
- `codex`, `claude`, `pi`, and `cursor` roots were `ok`.
- `hermes` and `pool` roots were missing and emitted source warnings, unrelated
  to the Codex examples.

Relevant source output:

```text
codex root: /home/ben/.codex/sessions
codex include: *.jsonl
codex status: ok
hermes status: missing
pool status: missing
```

## Live Root And Archive Evidence

Commands:

```bash
find /home/ben/.codex/sessions -path "*019e3f4c-81e2-75a0-a125-8ea2ea42dd9f*" -print
find /home/ben/.codex/sessions -path "*019e421a-f5fb-73b3-9d32-41f99f621639*" -print
find /home/ben/.codex/archived_sessions -path "*019e3f4c-81e2-75a0-a125-8ea2ea42dd9f*" -print
find /home/ben/.codex/archived_sessions -path "*019e421a-f5fb-73b3-9d32-41f99f621639*" -print
stat /home/ben/.codex/sessions/2026/05/19/rollout-2026-05-19T08-13-59-019e3f4c-81e2-75a0-a125-8ea2ea42dd9f.jsonl
stat /home/ben/.codex/sessions/2026/05/19/rollout-2026-05-19T21-18-43-019e421a-f5fb-73b3-9d32-41f99f621639.jsonl
```

Observed:

- No matching files were found under `/home/ben/.codex/sessions`.
- Both expected old live paths returned `No such file or directory`.
- Both files were found under `/home/ben/.codex/archived_sessions`:
  - `/home/ben/.codex/archived_sessions/rollout-2026-05-19T08-13-59-019e3f4c-81e2-75a0-a125-8ea2ea42dd9f.jsonl`
  - `/home/ben/.codex/archived_sessions/rollout-2026-05-19T21-18-43-019e421a-f5fb-73b3-9d32-41f99f621639.jsonl`
- `/home/ben/.codex/sessions` exists but currently has no top-level files in
  this probe.
- `/home/ben/.codex/archived_sessions` exists and had 168 top-level files.

Archive metadata confirms these are the expected sessions:

```text
019e3f4c-81e2-75a0-a125-8ea2ea42dd9f
timestamp: 2026-05-19T08:13:59.138Z
cwd: /data/projects/poolside-studio
source: vscode
cli_version: 0.130.0

019e421a-f5fb-73b3-9d32-41f99f621639
timestamp: 2026-05-19T21:18:43.707Z
cwd: /data/projects/poolside-studio
source: vscode
cli_version: 0.130.0
```

The archive files also contain the known-answer terms:

- First file: `initial-learning-swarm2`, `SilverHarbor`, `MistyGoose`.
- Second file: `ExternalUrlService`, `OAuth callback`, `xdg-open`.

## CASS Health And Search Evidence

Commands:

```bash
cass --version
cass health
cass status --json
cass doctor --check
cass search "019e3f4c-81e2-75a0-a125-8ea2ea42dd9f" --json --fields minimal --limit 8
cass search "019e421a-f5fb-73b3-9d32-41f99f621639" --json --fields minimal --limit 8
cass search "initial-learning-swarm2 SilverHarbor MistyGoose" --json --fields minimal --limit 8
cass search "ExternalUrlService OAuth callback xdg-open" --json --fields minimal --limit 8
cass search "degraded-archive-risk missing upstream source paths" --json --fields minimal --limit 8
```

Observed:

- Installed CASS version was `cass 0.6.6`.
- `cass health` exited 1 because the lexical index was stale.
- `cass status --json` reported:
  - `database.exists: true`
  - `database.opened: true`
  - database path `/home/ben/.local/share/coding-agent-search/agent_search.db`
  - `index.status: stale`
  - reason `lexical index is older than the stale threshold`
  - `rebuilding: false`
  - `stalled: false`
- Despite the stale health preflight, CASS searches were usable and returned the
  expected known-answer source paths.

Targeted CASS results:

```text
query: 019e3f4c-81e2-75a0-a125-8ea2ea42dd9f
total_matches: 9
first expected path:
/home/ben/.codex/sessions/2026/05/19/rollout-2026-05-19T08-13-59-019e3f4c-81e2-75a0-a125-8ea2ea42dd9f.jsonl

query: 019e421a-f5fb-73b3-9d32-41f99f621639
total_matches: 9
expected path appears in known-answer query results:
/home/ben/.codex/sessions/2026/05/19/rollout-2026-05-19T21-18-43-019e421a-f5fb-73b3-9d32-41f99f621639.jsonl

query: initial-learning-swarm2 SilverHarbor MistyGoose
total_matches: 9
expected first result:
/home/ben/.codex/sessions/2026/05/19/rollout-2026-05-19T08-13-59-019e3f4c-81e2-75a0-a125-8ea2ea42dd9f.jsonl

query: ExternalUrlService OAuth callback xdg-open
total_matches: 9
expected first result:
/home/ben/.codex/sessions/2026/05/19/rollout-2026-05-19T21-18-43-019e421a-f5fb-73b3-9d32-41f99f621639.jsonl
```

`cass doctor --check` completed read-only with no failures and three warnings:

```text
source_inventory: 153 indexed local conversations no longer have a visible upstream file
raw_mirror_backfill: 0 DB-only projections, including 153 missing upstream sources
source_coverage: 153 sole-copy warnings

Primary incident:
source-pruned-with-mirror-intact
Upstream source logs are missing, but cass has verified raw mirror evidence.
Archive risk: high; derived-index risk: none

Risk and next actions:
status: healthy
health: degraded-archive-risk
```

Interpretation:

- CASS is not broken for this investigation.
- The fast health command is red because the lexical index is stale, but the DB is
  open and searches for the relevant known answers succeed.
- The doctor warning matches the known local-memory pattern: old Codex source
  files moved away from the original `~/.codex/sessions/...` paths, while CASS
  retains indexed records and raw mirror evidence.
- The CASS warning is conservative archive-coverage noise for this product
  decision, not evidence that `agent-session-search` should treat CASS as a
  source of truth or replace FFF.

## CASS Metadata Evidence

Command:

```bash
sqlite3 -header -column /home/ben/.local/share/coding-agent-search/agent_search.db \
  "select c.id, c.source_path, a.name as agent, w.path as workspace, c.started_at, c.ended_at
   from conversations c
   left join agents a on a.id = c.agent_id
   left join workspaces w on w.id = c.workspace_id
   where c.source_path like '%019e3f4c-81e2-75a0-a125-8ea2ea42dd9f%'
      or c.source_path like '%019e421a-f5fb-73b3-9d32-41f99f621639%';"
```

Observed:

```text
id  source_path                                                                                                  agent  workspace
42  /home/ben/.codex/sessions/2026/05/19/rollout-2026-05-19T08-13-59-019e3f4c-81e2-75a0-a125-8ea2ea42dd9f.jsonl  codex  /data/projects/poolside-studio
54  /home/ben/.codex/sessions/2026/05/19/rollout-2026-05-19T21-18-43-019e421a-f5fb-73b3-9d32-41f99f621639.jsonl  codex  /data/projects/poolside-studio
```

`cass view` can also read the old source path even though `stat` says the
original file is gone, which is consistent with CASS serving from retained
indexed/raw mirror data.

## Classification

- Absent from live roots: yes.
- Archived elsewhere: yes, under `/home/ben/.codex/archived_sessions`.
- Config-recoverable: yes, by adding the archive directory as a configured source.
- Realpath/include related: no evidence. The configured `codex` root simply does
  not include the archive directory.
- Not reproducible: no. The gap is reproducible on this machine.
- Ranking related: no. Ranking cannot recover files outside searched roots.

## Recommended Path

Use a built-in `codex` source-root change, not config guidance alone.

Default source shape:

```json
{
  "roots": [
    {
      "name": "codex",
      "path": "/home/ben/.codex",
      "include": [
        "sessions/*.jsonl",
        "sessions/**/*.jsonl",
        "archived_sessions/*.jsonl",
        "archived_sessions/**/*.jsonl"
      ],
      "enabled": true
    }
  ]
}
```

This keeps `agent-session-search` inside its current design:

- raw session files remain the source of truth;
- FFF remains the search engine;
- configured roots still control search coverage and may override this default;
- canonical absolute paths remain attached to hits;
- no CASS integration or durable derived store is introduced.

Do not add a separate built-in `codex_archive` source. Keeping the archive under
`codex` means `--source codex` continues to mean Codex chat history, including
Codex-managed archived history.

## Validation Notes

This was a docs-only investigation. `npm test` was intentionally skipped because
no TypeScript, runtime behavior, or tests changed.
