# Current-Session Demotion Signals

Date: 2026-05-30

## Question

Can `search_sessions` safely identify and demote the caller's current live
session for Codex, Claude, Cursor, Pi, Hermes, and Pool without parsing
transcript bodies, guessing from paths, adding a new public MCP tool, or
exposing ranking scores in normal candidate output?

## Short Answer

Keep current-session demotion Codex-only for now.

The only signal verified in this pass that is both current-session scoped and
directly matchable to an indexed local session filename is `CODEX_THREAD_ID`.
Claude and Pi store usable session ids in local transcript filenames and
records, but I did not find a reliable runtime environment or client signal
that tells this MCP server which Claude or Pi transcript is the current caller.
Cursor exposes resume/list concepts, but no documented current chat id
environment variable was found. Hermes and Pool were not locally searchable
enough on this machine to justify product behavior.

If follow-up implementation work is created, it should be narrow: keep Codex
demotion, and only add another agent when a documented runtime signal can be
matched exactly against that agent's candidate `sessionId`.

## Evidence Gathered

Commands and surfaces checked:

```bash
npm run dev:cli -- sources --json
env | rg 'CODEX|CLAUDE|CURSOR|POOL|PI|HERMES|AGENT|MCP|TMUX|TERM|PWD' | sort
find ~/.codex/sessions ~/.claude/projects ~/.cursor/projects ~/.pi/agent/sessions ~/.hermes/sessions "$HOME/Library/Application Support/poolside" -maxdepth 4 -type f
find ~/.claude/projects -maxdepth 2 -type f -name '*.jsonl'
find ~/.cursor/projects -path '*agent-transcripts*' -type f
find ~/.pi/agent/sessions -type f
jq selected metadata from one Codex, Claude, and Pi transcript
pool config
```

Configured source status from `npm run dev:cli -- sources --json`:

| Source   | Root                                             | Status                                               |
| -------- | ------------------------------------------------ | ---------------------------------------------------- |
| `codex`  | `/home/ben/.codex/sessions`                      | `ok`                                                 |
| `claude` | `/home/ben/.claude/projects`                     | `ok`                                                 |
| `pi`     | `/home/ben/.pi/agent/sessions`                   | `ok`                                                 |
| `cursor` | `/home/ben/.cursor/projects`                     | `ok`, but no `agent-transcripts` files found locally |
| `hermes` | `/home/ben/.hermes/sessions`                     | `missing`                                            |
| `pool`   | `/home/ben/Library/Application Support/poolside` | `missing`                                            |

Local runtime evidence in this Codex pane:

```text
CODEX_THREAD_ID=019e7ae7-b19f-7c80-83dd-75b980ccbf4d
```

The matching Codex transcript exists at:

```text
/home/ben/.codex/sessions/2026/05/30/rollout-2026-05-30T22-01-05-019e7ae7-b19f-7c80-83dd-75b980ccbf4d.jsonl
```

Its `session_meta` record includes the same id, cwd, originator, and CLI
version:

```json
{
  "id": "019e7ae7-b19f-7c80-83dd-75b980ccbf4d",
  "cwd": "/data/projects/agent-session-search",
  "originator": "codex-tui",
  "cli_version": "0.135.0",
  "thread_source": "user"
}
```

Relevant external documentation checked:

- [Claude Code environment variables](https://code.claude.com/docs/en/env-vars)
  document `CLAUDECODE` for subprocess detection and
  `CLAUDE_CODE_REMOTE_SESSION_ID` for cloud sessions, but this is not a
  verified local transcript id signal for `~/.claude/projects`.
- [Cursor CLI parameters](https://docs.cursor.com/en/cli/reference/parameters)
  document `--resume [chatId]`, and
  [Cursor CLI overview](https://docs.cursor.com/en/cli/overview) shows resume
  by chat id, but I found no official current-chat-id environment variable.
- [Poolside CLI reference](https://docs.poolside.ai/cli/cli-reference)
  documents `pool config` and history commands for logs, trajectories, and
  sessions, but no current-session id environment signal was found in this
  pass.

## Signal Inventory

| Source | Candidate `sessionId` shape in indexed files                                                              | Plausible current-session signal                                                                           | Classification                                           |
| ------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Codex  | UUID-like id in filename and `session_meta.payload.id`                                                    | `CODEX_THREAD_ID`                                                                                          | Reliable when present and equal to candidate `sessionId` |
| Claude | UUID filename under `~/.claude/projects/<encoded-cwd>/`; records include `sessionId`                      | No verified local env signal. Official docs expose `CLAUDE_CODE_REMOTE_SESSION_ID` only for cloud sessions | Do not implement local demotion from current evidence    |
| Cursor | Config expects `*/agent-transcripts/**/*.jsonl` or `*.json`; none found locally                           | Docs expose resume/list chat ids, not a current id env var                                                 | Do not implement                                         |
| Pi     | Files are `<timestamp>_<uuid>.jsonl`; first record has `{ "type": "session", "id": "...", "cwd": "..." }` | No verified runtime env/client signal found                                                                | Do not implement                                         |
| Hermes | Configured root missing locally; only `~/.hermes/config.yaml` and skills present                          | No verified session storage or current id signal                                                           | Do not implement                                         |
| Pool   | Configured root missing locally; `pool config` did not produce usable output here                         | Pool docs expose history/config commands, not a current id env var                                         | Do not implement                                         |

## Reliable Signals

### Codex: `CODEX_THREAD_ID`

`CODEX_THREAD_ID` is safe for demotion when all of these are true:

1. The value exists.
2. The value exactly equals a candidate `sessionId` extracted from the
   canonical candidate path.
3. The candidate source is `codex`.

This is a direct identity match, not a path guess or transcript-content guess.
It is also resilient to unrelated sessions with similar cwd, branch, or prompt
text.

Open implementation caution: if `agent-session-search-mcp` is ever run as a
long-lived server outside the caller's live agent process, process environment
variables can become stale or absent. Any implementation should make that
failure mode no-op rather than demoting anything.

## Unsafe Or Unproven Signals

These should not drive demotion:

- Matching `operationalContext.cwd` to path directories. That identifies a
  project, not a current transcript, and would incorrectly demote older useful
  sessions from the same repo.
- Choosing the most recently modified file under a source root. Fresh files can
  be unrelated background jobs, other panes, or another agent.
- Looking for the user query, prompt text, pane id, cwd, model, branch, or
  current task text inside transcript content. This is exactly the
  self-contamination failure mode demotion is meant to reduce.
- Treating Claude `CLAUDE_CODE_REMOTE_SESSION_ID` as local transcript identity.
  The official docs describe a cloud-session id used for transcript links, not
  a verified match to `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`.
- Treating Cursor `--resume [chatId]`, `cursor-agent resume`, or
  `cursor-agent ls` as a current-session signal. Those are CLI controls for
  resuming/listing conversations, not evidence that an MCP request came from a
  specific current chat.
- Treating Pool `pool history ... --latest` as currentness. Latest history is a
  recency query, not caller identity.

## Recommendation

Keep Codex-only current-session demotion for the ranking lane, and document the
cross-agent limitation rather than implementing speculative demotion.

The next code bead should only include Codex unless another agent exposes a
stable signal that can be tested as an exact `source + sessionId` match. The
normal response shape should remain score-free. Debug mode can later explain
whether a candidate was demoted, but that is separate from this investigation.

## Narrow Follow-Up Bead Draft

Only create this if the ranking implementation bead does not already cover the
Codex behavior.

Title: Implement safe Codex current-session demotion

Outcome: Default candidate ranking demotes the current Codex transcript when
`CODEX_THREAD_ID` exactly matches a Codex candidate `sessionId`, without
affecting evidence mode or non-Codex sources.

Scope:

- Read `process.env.CODEX_THREAD_ID` inside the ranking path, or inject it via
  test-only options if the existing implementation pattern needs dependency
  control.
- Apply demotion only when `candidate.source === "codex"` and
  `candidate.sessionId === CODEX_THREAD_ID`.
- Treat missing, malformed, stale, or nonmatching values as no-op.
- Do not parse transcript bodies.
- Do not demote by cwd, mtime, query text, preview, path coincidence, or
  operational context.
- Do not add a new MCP tool or normal output field.

Acceptance criteria:

- A Codex candidate with matching `sessionId` sorts behind a non-current
  historical candidate even when it has more hits.
- A non-Codex candidate with the same UUID-like basename is not demoted.
- Missing or nonmatching `CODEX_THREAD_ID` preserves normal ranking.
- Evidence mode ordering/shape remains unchanged.
- Debug output, if ranking debug exists by then, may report demotion as
  internal diagnostics only.

Validation:

```bash
npm run check
npm test
```

## Closure Rationale

This investigation does not recommend cross-agent implementation now. The
failure cost of false demotion is high: it can hide the most useful recent
session for a source. The evidence here supports one exact identity signal
(`CODEX_THREAD_ID`) and several transcript id storage formats, but transcript
storage alone is not a caller-currentness contract.
