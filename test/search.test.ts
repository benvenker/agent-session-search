import {
  mkdir,
  mkdtemp,
  realpath,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionSearch } from "../src/search.js";
import { groupCandidates } from "./support/followup.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function touchFile(path: string, ageMs: number) {
  await writeSessionFile(path, "", ageMs);
}

async function writeSessionFile(path: string, content: string, ageMs: number) {
  await writeFile(path, content);
  const time = new Date(Date.now() - ageMs);
  await utimes(path, time, time);
}

const AUTH_TOKEN_TIMEOUT_PATTERNS = [
  "auth token timeout",
  "auth token",
  "token timeout",
  "timeout",
  "token",
  "auth",
];
const AUTH_TOKEN_TIMEOUT_PATTERNS_MAX_3 = AUTH_TOKEN_TIMEOUT_PATTERNS.slice(
  0,
  3
);
const NOTHING_SHOULD_MATCH_PATTERNS = [
  "nothing should match this",
  "nothing",
  "match",
];
const ALL_SOURCES_FAILED_RECOMMENDED_ACTION =
  "Verify source roots and fff-mcp with agent-session-search sources --json and agent-session-search-doctor. For exhaustive proof, run the rg fallback command in the warning message.";
const BROAD_EVIDENCE_CAPPED_RECOMMENDED_ACTION =
  "Start with candidates mode, expand a promising group with more.groupCandidates, then request focused evidence with the selected candidate path.";

function candidateLeads(result: { results: any[] }) {
  return result.results.flatMap((entry) =>
    Array.isArray(entry.leads) ? entry.leads : [entry]
  );
}

describe("createSessionSearch", () => {
  it("returns compact session candidates by default", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot, include: ["*.jsonl"] }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search() {
            const sessionPath = join(
              source.root,
              "rollout-2026-04-29T10-15-17-019dd9cf-08bd-7580-827e-870084b36b6a.jsonl"
            );
            const otherSessionPath = join(source.root, "other.jsonl");
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: sessionPath,
                  line: 12,
                  content: "Done on paper-cuts / PR #227",
                  pattern: "PR #227",
                },
                {
                  source: source.name,
                  root: source.root,
                  path: sessionPath,
                  line: 40,
                  content:
                    "Pushed https://github.com/poolsideai/poolside-studio/pull/227",
                  pattern: "pull/227",
                },
                {
                  source: source.name,
                  root: source.root,
                  path: otherSessionPath,
                  line: 3,
                  content: "Unrelated bare timestamp 227",
                  pattern: "227",
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "find PR 227 papercuts branch",
      queries: ["PR #227", "paper-cuts"],
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalSessionPath = join(
      canonicalCodexRoot,
      "rollout-2026-04-29T10-15-17-019dd9cf-08bd-7580-827e-870084b36b6a.jsonl"
    );
    const canonicalOtherPath = join(canonicalCodexRoot, "other.jsonl");

    expect(result.resultsDisplayMode).toBe("candidates");
    expect(result.resultsShape).toBe("candidate_groups");
    expect(result.metadata).toMatchObject({
      contractVersion: "progressive-evidence-groups.v2",
      resultsDisplayMode: "candidates",
      resultsShape: "candidate_groups",
      backend: { mode: "custom" },
      limits: { candidateGroupLeadLimit: 5 },
      countSemantics: {
        relation: "eq means exact; gte means lower bound",
        hitCount: "physical matched lines, not pattern-line pairs",
      },
    });
    expect(candidateLeads(result)).toMatchObject([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: canonicalSessionPath,
        sessionId: "019dd9cf-08bd-7580-827e-870084b36b6a",
        line: 12,
        preview: "Done on paper-cuts / PR #227",
        hitCount: 2,
        matchedQueries: ["PR #227"],
        matchedPatterns: ["PR #227", "pull/227"],
        more: {
          evidence: {
            query: "find PR 227 papercuts branch",
            queries: ["PR #227", "paper-cuts"],
            sources: ["codex"],
            resultsDisplayMode: "evidence",
            paths: [canonicalSessionPath],
          },
        },
      },
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: canonicalOtherPath,
        line: 3,
        preview: "Unrelated bare timestamp 227",
        hitCount: 1,
        matchedQueries: ["PR #227"],
        matchedPatterns: ["227"],
        more: {
          evidence: {
            query: "find PR 227 papercuts branch",
            queries: ["PR #227", "paper-cuts"],
            sources: ["codex"],
            resultsDisplayMode: "evidence",
            paths: [canonicalOtherPath],
          },
        },
      },
    ]);
  });

  it("counts candidate hitCount as physical hits while ranking on pattern density", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot, include: ["*.jsonl"] }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "multi-pattern.jsonl"),
                  line: 8,
                  content: "one physical hit matched two adjacent probes",
                  patterns: [input.patterns[1], input.patterns[2]],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "single-pattern.jsonl"),
                  line: 2,
                  content: "one physical hit matched one exact probe",
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      debug: true,
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const multiPatternPath = join(canonicalCodexRoot, "multi-pattern.jsonl");
    const multiPatternLead = candidateLeads(result).find(
      (candidate) => candidate.path === multiPatternPath
    );
    const multiPatternDebug = result.debug?.ranking?.candidates.find(
      (candidate) => candidate.path === multiPatternPath
    );

    expect(multiPatternLead).toMatchObject({
      path: multiPatternPath,
      hitCount: 1,
      matchedPatterns: ["auth token", "token timeout"],
    });
    expect(multiPatternDebug).toMatchObject({
      path: multiPatternPath,
      hitCount: 1,
      patternMatchCount: 2,
    });
    expect(multiPatternDebug?.densityPoints).toBeCloseTo(Math.log2(3));
  });

  it("rejects group candidate follow-ups whose group no longer matches the query plan", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot, include: ["*.jsonl"] }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search() {
            throw new Error("search should not run for invalid follow-ups");
          },
        };
      },
    });

    await expect(
      search.searchSessions({
        query: "auth token timeout",
        groupCandidates: groupCandidates({
          query: "auth token timeout",
          sources: ["codex"],
          resultsDisplayMode: "candidates",
          group: {
            id: "exact_or_structured",
            priority: 1,
            patternIds: ["p1"],
          },
          offset: 0,
          limit: 5,
        }) as any,
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "groupCandidates.group.priority",
    });

    await expect(
      search.searchSessions({
        query: "auth token timeout",
        groupCandidates: groupCandidates({
          query: "auth token timeout",
          sources: ["codex"],
          resultsDisplayMode: "candidates",
          group: {
            id: "exact_or_structured",
            priority: 0,
            patternIds: ["p999"],
          },
          offset: 0,
          limit: 5,
        }) as any,
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "groupCandidates.group.patternIds",
    });
  });

  it("limits candidate debug ranking to displayed group leads", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot, include: ["*.jsonl"] }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: Array.from({ length: 8 }, (_, index) => ({
                source: source.name,
                root: source.root,
                path: join(source.root, `candidate-${index + 1}.jsonl`),
                line: 1,
                content: `candidate ${index + 1}`,
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      debug: true,
    });
    const exactGroup = result.results[0] as any;

    expect(exactGroup.assignedCandidateCount).toEqual({
      value: 8,
      relation: "eq",
    });
    expect(exactGroup.shownLeadCount).toBe(5);
    expect(exactGroup.more?.groupCandidates.fingerprint).toMatch(/^gcf1:/);
    expect(result.debug?.ranking?.candidates).toHaveLength(5);
    expect(
      result.debug?.ranking?.candidates.map((entry) => entry.path)
    ).toEqual(exactGroup.leads.map((lead: any) => lead.path));

    const nextPage = await search.searchSessions({
      query: "auth token timeout",
      groupCandidates: exactGroup.more.groupCandidates,
      debug: true,
    });

    expect(
      nextPage.debug?.ranking?.candidates.map((entry) => entry.rank)
    ).toEqual([6, 7, 8]);
  });

  it("replays server-prepared group follow-ups with the original effective search state", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot, include: ["*.jsonl"] },
          { name: "claude", path: claudeRoot, include: ["*.jsonl"] },
        ],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push({ source: source.name, input });
            return {
              warnings: [],
              results: Array.from({ length: 6 }, (_, index) => ({
                source: source.name,
                root: source.root,
                path: join(source.root, `candidate-${index + 1}.jsonl`),
                line: 1,
                content: `${source.name} candidate ${index + 1}`,
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const firstPage = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      maxPatterns: 3,
      maxResultsPerSource: 6,
      context: 2,
      operationalContext: { repo: "agent-session-search" },
      callerSession: {
        source: "claude",
        sessionId: "019dd9cf-08bd-7580-827e-870084b36b6b",
      },
    });
    const exactGroup = firstPage.results[0] as any;

    expect(exactGroup.more.groupCandidates).toMatchObject({
      query: "auth token timeout",
      sources: ["codex", "claude"],
      maxPatterns: 3,
      maxResultsPerSource: 6,
      context: 2,
      operationalContext: { repo: "agent-session-search" },
      callerSession: {
        source: "claude",
        sessionId: "019dd9cf-08bd-7580-827e-870084b36b6b",
      },
      offset: 6,
      limit: 6,
    });
    expect(exactGroup.more.groupCandidates).not.toHaveProperty("days");
    expect(exactGroup.more.groupCandidates).not.toHaveProperty("workspace");

    calls.length = 0;
    await expect(
      search.searchSessions({
        query: "auth token timeout",
        groupCandidates: exactGroup.more.groupCandidates,
      })
    ).resolves.toMatchObject({ resultsDisplayMode: "candidates" });

    expect(calls).toEqual([
      {
        source: "codex",
        input: {
          patterns: AUTH_TOKEN_TIMEOUT_PATTERNS_MAX_3,
          maxResults: undefined,
          context: 2,
          include: ["*.jsonl"],
        },
      },
      {
        source: "claude",
        input: {
          patterns: AUTH_TOKEN_TIMEOUT_PATTERNS_MAX_3,
          maxResults: undefined,
          context: 2,
          include: ["*.jsonl"],
        },
      },
    ]);
  });

  it("carries canonical session filters through group candidate replay", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const realWorkspace = join(tmp, "real-workspace");
    const workspaceAlias = join(tmp, "workspace-alias");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(realWorkspace);
    await symlink(realWorkspace, workspaceAlias, "dir");
    await writeFile(
      configPath,
      JSON.stringify({ roots: [{ name: "codex", path: codexRoot }] })
    );
    const currentTime = Date.now();
    const eligiblePaths = Array.from({ length: 6 }, (_, index) =>
      join(realWorkspace, `eligible-${index + 1}.jsonl`)
    );
    const stalePaths = Array.from({ length: 4 }, (_, index) =>
      join(realWorkspace, `stale-${index + 1}.jsonl`)
    );
    const outsidePaths = Array.from({ length: 4 }, (_, index) =>
      join(codexRoot, `outside-${index + 1}.jsonl`)
    );
    for (const path of [...eligiblePaths, ...stalePaths, ...outsidePaths]) {
      await writeFile(path, "auth token timeout");
      await utimes(path, new Date(currentTime), new Date(currentTime));
    }
    const staleTime = new Date(currentTime - 90 * 86_400_000);
    for (const path of stalePaths) {
      await utimes(path, staleTime, staleTime);
    }
    const highDensityResults = (source: any, path: string) =>
      Array.from({ length: 10 }, (_, index) => ({
        source: source.name,
        root: source.root,
        path,
        line: index + 1,
        content: `dense auth token timeout ${index + 1}`,
        pattern: "auth token timeout",
      }));
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      now: () => currentTime,
      createBackend(source) {
        return {
          async search() {
            return {
              warnings: [],
              results: [
                ...stalePaths.flatMap((path) =>
                  highDensityResults(source, path)
                ),
                ...outsidePaths.flatMap((path) =>
                  highDensityResults(source, path)
                ),
                ...eligiblePaths.map((path, index) => ({
                  source: source.name,
                  root: source.root,
                  path,
                  line: index + 1,
                  content: `eligible auth token timeout ${index + 1}`,
                  pattern: "auth token timeout",
                })),
              ],
            };
          },
        };
      },
    });

    const firstPage = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      maxResultsPerSource: 2,
      days: 30,
      workspace: workspaceAlias,
    });
    const firstGroup = firstPage.results[0] as any;
    const followup = firstGroup.more.groupCandidates;

    expect(followup).toMatchObject({
      days: 30,
      workspace: workspaceAlias,
      offset: 2,
      limit: 2,
    });
    for (const lead of firstGroup.leads) {
      expect(lead.more.evidence).not.toHaveProperty("days");
      expect(lead.more.evidence).not.toHaveProperty("workspace");
    }

    const replay = await search.searchSessions({
      query: "ignored in favor of server state",
      groupCandidates: followup,
    });
    const replayGroup = replay.results[0] as any;

    expect(replayGroup.leads.map(({ path }: any) => path)).toEqual(
      eligiblePaths.slice(2, 4)
    );
    expect(replayGroup.more.groupCandidates).toMatchObject({
      days: 30,
      workspace: workspaceAlias,
      offset: 4,
      limit: 2,
    });
  });

  it("preserves symlink-alias encoded workspace matches during group replay", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const realWorkspace = join(tmp, "real-workspace");
    const workspaceAlias = join(tmp, "workspace-alias");
    const aliasEncodedRoot = join(
      codexRoot,
      workspaceAlias.replace(/[^a-zA-Z0-9]/g, "-")
    );
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(realWorkspace);
    await symlink(realWorkspace, workspaceAlias, "dir");
    await mkdir(aliasEncodedRoot);
    await writeFile(
      configPath,
      JSON.stringify({ roots: [{ name: "codex", path: codexRoot }] })
    );
    const sessionPaths = Array.from({ length: 4 }, (_, index) =>
      join(aliasEncodedRoot, `session-${index + 1}.jsonl`)
    );
    for (const path of sessionPaths) {
      await writeFile(path, "auth token timeout");
    }
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search() {
            return {
              warnings: [],
              results: sessionPaths.map((path, index) => ({
                source: source.name,
                root: source.root,
                path,
                line: index + 1,
                content: `auth token timeout ${index + 1}`,
                pattern: "auth token timeout",
              })),
            };
          },
        };
      },
    });

    const firstPage = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      maxResultsPerSource: 2,
      workspace: workspaceAlias,
    });
    const firstGroup = firstPage.results[0] as any;
    const firstPagePaths = firstGroup.leads.map(({ path }: any) => path);
    expect(firstPagePaths).toHaveLength(2);
    expect(firstGroup.more.groupCandidates.workspace).toBe(workspaceAlias);
    expect(firstPage.metadata.filters).toEqual({ workspace: realWorkspace });

    const replay = await search.searchSessions({
      query: "ignored in favor of server state",
      groupCandidates: firstGroup.more.groupCandidates,
    });
    const replayGroup = replay.results[0] as any;
    const replayPaths = replayGroup.leads.map(({ path }: any) => path);
    expect(replayPaths).toHaveLength(2);
    expect([...firstPagePaths, ...replayPaths].sort()).toEqual(
      sessionPaths.sort()
    );
    expect(replay.metadata.filters).toEqual({ workspace: realWorkspace });
  });

  it("rejects group follow-ups when the resolved source plan changes", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot, include: ["*.jsonl"] }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: Array.from({ length: 8 }, (_, index) => ({
                source: source.name,
                root: source.root,
                path: join(source.root, `candidate-${index + 1}.jsonl`),
                line: 1,
                content: `candidate ${index + 1}`,
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const firstPage = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      maxResultsPerSource: 5,
    });
    const exactGroup = firstPage.results[0] as any;

    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot, include: ["sessions/*.jsonl"] },
        ],
      })
    );

    await expect(
      search.searchSessions({
        query: "auth token timeout",
        groupCandidates: exactGroup.more.groupCandidates,
      })
    ).rejects.toMatchObject({
      code: "invalid_group_followup",
      invalidField: "groupCandidates.planFingerprint",
    });
  });

  it("fans out one query across multiple selected roots and returns grouped evidence", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot, include: ["*.jsonl"] },
          { name: "claude", path: claudeRoot, include: ["*.jsonl"] },
        ],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push({ source, input });
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, `${source.name}.jsonl`),
                  line: 7,
                  content: `${source.name} saw ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["codex", "claude"],
      resultsDisplayMode: "evidence",
    });

    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalClaudeRoot = await realpath(claudeRoot);
    expect(result).toEqual({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      resultsShape: "evidence_groups",
      expandedPatterns: AUTH_TOKEN_TIMEOUT_PATTERNS,
      metadata: {
        contractVersion: "progressive-evidence-groups.v2",
        resultsDisplayMode: "evidence",
        resultsShape: "evidence_groups",
        backend: { mode: "custom" },
        limits: {
          maxResultsPerSource: 20,
          candidateGroupLeadLimit: 20,
          unscopedEvidenceDefaultCap: 20,
        },
        countSemantics: {
          relation: "eq means exact; gte means lower bound",
          assignedCandidateCount:
            "canonical candidates assigned to the group before lead slicing",
          hitCount: "physical matched lines, not pattern-line pairs",
          shownLeadCount: "leads included in this response",
        },
      },
      searchedSources: [
        {
          name: "codex",
          root: canonicalCodexRoot,
          include: ["*.jsonl"],
          status: "ok",
        },
        {
          name: "claude",
          root: canonicalClaudeRoot,
          include: ["*.jsonl"],
          status: "ok",
        },
      ],
      warnings: [],
      results: [
        {
          source: "codex",
          root: canonicalCodexRoot,
          path: join(canonicalCodexRoot, "codex.jsonl"),
          hitCount: 1,
          matchedQueries: ["auth token timeout"],
          matchedPatterns: ["auth token timeout"],
          snippets: [
            {
              line: 7,
              content: "codex saw auth token timeout",
              pattern: "auth token timeout",
              query: "auth token timeout",
            },
          ],
          more: {
            evidence: {
              query: "auth token timeout",
              sources: ["codex"],
              resultsDisplayMode: "evidence",
              paths: [join(canonicalCodexRoot, "codex.jsonl")],
            },
          },
        },
        {
          source: "claude",
          root: canonicalClaudeRoot,
          path: join(canonicalClaudeRoot, "claude.jsonl"),
          hitCount: 1,
          matchedQueries: ["auth token timeout"],
          matchedPatterns: ["auth token timeout"],
          snippets: [
            {
              line: 7,
              content: "claude saw auth token timeout",
              pattern: "auth token timeout",
              query: "auth token timeout",
            },
          ],
          more: {
            evidence: {
              query: "auth token timeout",
              sources: ["claude"],
              resultsDisplayMode: "evidence",
              paths: [join(canonicalClaudeRoot, "claude.jsonl")],
            },
          },
        },
      ],
    });
    expect(calls).toEqual([
      {
        source: {
          name: "codex",
          root: canonicalCodexRoot,
          include: ["*.jsonl"],
          status: "ok",
        },
        input: {
          patterns: AUTH_TOKEN_TIMEOUT_PATTERNS,
          maxResults: undefined,
          context: undefined,
          include: ["*.jsonl"],
        },
      },
      {
        source: {
          name: "claude",
          root: canonicalClaudeRoot,
          include: ["*.jsonl"],
          status: "ok",
        },
        input: {
          patterns: AUTH_TOKEN_TIMEOUT_PATTERNS,
          maxResults: undefined,
          context: undefined,
          include: ["*.jsonl"],
        },
      },
    ]);
  });

  it("searches ok source roots concurrently while merging results in source order", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot },
          { name: "claude", path: claudeRoot },
        ],
      })
    );

    let claudeStarted!: () => void;
    const claudeStartedPromise = new Promise<void>((resolve) => {
      claudeStarted = resolve;
    });
    const startOrder: string[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            startOrder.push(source.name);
            if (source.name === "codex") {
              await claudeStartedPromise;
            } else {
              claudeStarted();
            }
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, `${source.name}.jsonl`),
                  line: source.name === "codex" ? 10 : 20,
                  content: `${source.name} saw ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const outcome = await Promise.race([
      search
        .searchSessions({
          query: "auth token timeout",
          sources: ["codex", "claude"],
          resultsDisplayMode: "evidence",
        })
        .then((result) => ({ type: "result" as const, result })),
      sleep(50).then(() => ({ type: "timeout" as const })),
    ]);
    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalClaudeRoot = await realpath(claudeRoot);

    expect(outcome.type).toBe("result");
    if (outcome.type !== "result") {
      return;
    }
    expect(startOrder).toEqual(["codex", "claude"]);
    expect(outcome.result.results).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: join(canonicalCodexRoot, "codex.jsonl"),
        hitCount: 1,
        matchedQueries: ["auth token timeout"],
        matchedPatterns: ["auth token timeout"],
        snippets: [
          {
            line: 10,
            content: "codex saw auth token timeout",
            pattern: "auth token timeout",
            query: "auth token timeout",
          },
        ],
        more: {
          evidence: {
            query: "auth token timeout",
            sources: ["codex"],
            resultsDisplayMode: "evidence",
            paths: [join(canonicalCodexRoot, "codex.jsonl")],
          },
        },
      },
      {
        source: "claude",
        root: canonicalClaudeRoot,
        path: join(canonicalClaudeRoot, "claude.jsonl"),
        hitCount: 1,
        matchedQueries: ["auth token timeout"],
        matchedPatterns: ["auth token timeout"],
        snippets: [
          {
            line: 20,
            content: "claude saw auth token timeout",
            pattern: "auth token timeout",
            query: "auth token timeout",
          },
        ],
        more: {
          evidence: {
            query: "auth token timeout",
            sources: ["claude"],
            resultsDisplayMode: "evidence",
            paths: [join(canonicalClaudeRoot, "claude.jsonl")],
          },
        },
      },
    ]);
  });

  it("ranks default candidates by recency and hit density without exposing scores", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );
    const denseRecentPath = join(codexRoot, "dense-recent.jsonl");
    const freshNoisePath = join(codexRoot, "fresh-noise.jsonl");
    const oldDensePath = join(codexRoot, "old-dense.jsonl");
    await touchFile(denseRecentPath, 3 * 60 * 60 * 1000);
    await touchFile(freshNoisePath, 30 * 60 * 1000);
    await touchFile(oldDensePath, 40 * 24 * 60 * 60 * 1000);

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: freshNoisePath,
                  line: 1,
                  content: "fresh one-hit noise",
                  pattern: input.patterns[0],
                },
                ...Array.from({ length: 8 }, (_, index) => ({
                  source: source.name,
                  root: source.root,
                  path: denseRecentPath,
                  line: index + 1,
                  content: `dense recent ${index + 1}`,
                  pattern: input.patterns[0],
                })),
                ...Array.from({ length: 12 }, (_, index) => ({
                  source: source.name,
                  root: source.root,
                  path: oldDensePath,
                  line: index + 1,
                  content: `old dense ${index + 1}`,
                  pattern: input.patterns[0],
                })),
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const candidates = candidateLeads(result);

    expect(result.resultsShape).toBe("candidate_groups");
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      join(canonicalCodexRoot, "dense-recent.jsonl"),
      join(canonicalCodexRoot, "fresh-noise.jsonl"),
      join(canonicalCodexRoot, "old-dense.jsonl"),
    ]);
    expect(candidates[0]).toMatchObject({
      path: join(canonicalCodexRoot, "dense-recent.jsonl"),
      hitCount: 8,
      preview: "dense recent 1",
    });
    for (const candidate of candidates) {
      expect(candidate).not.toHaveProperty("score");
      expect(candidate).not.toHaveProperty("mtime");
      expect(candidate).not.toHaveProperty("ranking");
    }
  });

  it("demotes the current Codex session below historical candidates", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    const currentSessionId = "019dd9cf-08bd-7580-827e-870084b36b6a";
    const currentPath = join(
      codexRoot,
      `rollout-2026-04-29T10-15-17-${currentSessionId}.jsonl`
    );
    const historicalPath = join(codexRoot, "historical.jsonl");
    await mkdir(codexRoot);
    await touchFile(currentPath, 30 * 60 * 1000);
    await touchFile(historicalPath, 3 * 60 * 60 * 1000);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const previousThreadId = process.env.CODEX_THREAD_ID;
    process.env.CODEX_THREAD_ID = currentSessionId;
    try {
      const search = createSessionSearch({
        configPath,
        defaultRoots: [],
        createBackend(source) {
          return {
            async search(input) {
              return {
                warnings: [],
                results: [
                  ...Array.from({ length: 12 }, (_, index) => ({
                    source: source.name,
                    root: source.root,
                    path: currentPath,
                    line: index + 1,
                    content: `current echo ${index + 1}`,
                    pattern: input.patterns[0],
                  })),
                  {
                    source: source.name,
                    root: source.root,
                    path: historicalPath,
                    line: 1,
                    content: "historical answer",
                    pattern: input.patterns[0],
                  },
                ],
              };
            },
          };
        },
      });

      const result = await search.searchSessions({
        query: "auth token timeout",
      });
      const canonicalCodexRoot = await realpath(codexRoot);

      expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual(
        [
          join(canonicalCodexRoot, "historical.jsonl"),
          join(
            canonicalCodexRoot,
            `rollout-2026-04-29T10-15-17-${currentSessionId}.jsonl`
          ),
        ]
      );
      expect(candidateLeads(result)[1]).toMatchObject({
        sessionId: currentSessionId,
        hitCount: 12,
      });
    } finally {
      if (previousThreadId === undefined) {
        delete process.env.CODEX_THREAD_ID;
      } else {
        process.env.CODEX_THREAD_ID = previousThreadId;
      }
    }
  });

  it("demotes Codex child sessions of the current caller", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    const currentSessionId = "019edc70-1cd3-7943-8304-ad9f2c240996";
    const childSessionId = "019edc70-aaaa-7aaa-aaaa-aaaaaaaaaaaa";
    const childPath = join(
      codexRoot,
      `rollout-2026-06-18T20-31-00-${childSessionId}.jsonl`
    );
    const historicalPath = join(codexRoot, "historical.jsonl");
    await mkdir(codexRoot);
    await writeSessionFile(
      childPath,
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          id: childSessionId,
          parent_thread_id: currentSessionId,
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: currentSessionId,
              },
            },
          },
        },
      })}\n`,
      30 * 60 * 1000
    );
    await touchFile(historicalPath, 3 * 60 * 60 * 1000);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const previousThreadId = process.env.CODEX_THREAD_ID;
    process.env.CODEX_THREAD_ID = currentSessionId;
    try {
      const search = createSessionSearch({
        configPath,
        defaultRoots: [],
        createBackend(source) {
          return {
            async search(input) {
              return {
                warnings: [],
                results: [
                  ...Array.from({ length: 12 }, (_, index) => ({
                    source: source.name,
                    root: source.root,
                    path: childPath,
                    line: index + 1,
                    content: `child current echo ${index + 1}`,
                    pattern: input.patterns[0],
                  })),
                  {
                    source: source.name,
                    root: source.root,
                    path: historicalPath,
                    line: 1,
                    content: "historical answer",
                    pattern: input.patterns[0],
                  },
                ],
              };
            },
          };
        },
      });

      const result = await search.searchSessions({
        query: "auth token timeout",
        resultsDisplayMode: "candidates",
        debug: true,
      });
      const canonicalCodexRoot = await realpath(codexRoot);

      expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual(
        [
          join(canonicalCodexRoot, "historical.jsonl"),
          join(
            canonicalCodexRoot,
            `rollout-2026-06-18T20-31-00-${childSessionId}.jsonl`
          ),
        ]
      );
      expect(result.debug?.ranking?.candidates[1]).toMatchObject({
        sessionId: childSessionId,
        isCurrentSession: true,
      });
    } finally {
      if (previousThreadId === undefined) {
        delete process.env.CODEX_THREAD_ID;
      } else {
        process.env.CODEX_THREAD_ID = previousThreadId;
      }
    }
  });

  it("demotes an explicit caller session for any matching source", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    const currentSessionId = "019dd9cf-08bd-7580-827e-870084b36b6b";
    const currentPath = join(claudeRoot, `${currentSessionId}.jsonl`);
    const historicalPath = join(claudeRoot, "historical.jsonl");
    await mkdir(claudeRoot);
    await touchFile(currentPath, 30 * 60 * 1000);
    await touchFile(historicalPath, 3 * 60 * 60 * 1000);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "claude", path: claudeRoot }],
      })
    );

    const previousThreadId = process.env.CODEX_THREAD_ID;
    delete process.env.CODEX_THREAD_ID;
    try {
      const search = createSessionSearch({
        configPath,
        defaultRoots: [],
        createBackend(source) {
          return {
            async search(input) {
              return {
                warnings: [],
                results: [
                  ...Array.from({ length: 12 }, (_, index) => ({
                    source: source.name,
                    root: source.root,
                    path: currentPath,
                    line: index + 1,
                    content: `current echo ${index + 1}`,
                    pattern: input.patterns[0],
                  })),
                  {
                    source: source.name,
                    root: source.root,
                    path: historicalPath,
                    line: 1,
                    content: "historical answer",
                    pattern: input.patterns[0],
                  },
                ],
              };
            },
          };
        },
      });

      const result = await search.searchSessions({
        query: "auth token timeout",
        callerSession: {
          source: "claude",
          sessionId: currentSessionId,
        },
      });
      const canonicalClaudeRoot = await realpath(claudeRoot);

      expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual(
        [
          join(canonicalClaudeRoot, "historical.jsonl"),
          join(canonicalClaudeRoot, `${currentSessionId}.jsonl`),
        ]
      );
      expect(candidateLeads(result)[1]).toMatchObject({
        source: "claude",
        sessionId: currentSessionId,
        hitCount: 12,
      });
    } finally {
      if (previousThreadId === undefined) {
        delete process.env.CODEX_THREAD_ID;
      } else {
        process.env.CODEX_THREAD_ID = previousThreadId;
      }
    }
  });

  it("keeps original candidate order when mtimes are missing", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "missing-a.jsonl"),
                  line: 1,
                  content: "first missing path",
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "missing-b.jsonl"),
                  line: 1,
                  content: "second missing path",
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
    });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual([
      join(canonicalCodexRoot, "missing-a.jsonl"),
      join(canonicalCodexRoot, "missing-b.jsonl"),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("gives a bounded boost to safe current-project candidate matches", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const currentProjectRoot = join(tmp, "projects", "current-app");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(currentProjectRoot, { recursive: true });
    await mkdir(join(codexRoot, "current-app"));
    await mkdir(join(codexRoot, "other-app"));
    const currentProjectPath = join(codexRoot, "current-app", "session.jsonl");
    const unrelatedFreshPath = join(codexRoot, "other-app", "session.jsonl");
    await touchFile(currentProjectPath, 23 * 60 * 60 * 1000);
    await touchFile(unrelatedFreshPath, 30 * 60 * 1000);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: unrelatedFreshPath,
                  line: 1,
                  content: "fresh unrelated",
                  pattern: input.patterns[0],
                },
                ...Array.from({ length: 3 }, (_, index) => ({
                  source: source.name,
                  root: source.root,
                  path: currentProjectPath,
                  line: index + 1,
                  content: `current project ${index + 1}`,
                  pattern: input.patterns[0],
                })),
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      operationalContext: { cwd: currentProjectRoot },
    });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual([
      join(canonicalCodexRoot, "current-app", "session.jsonl"),
      join(canonicalCodexRoot, "other-app", "session.jsonl"),
    ]);
    for (const candidate of candidateLeads(result)) {
      expect(candidate).not.toHaveProperty("score");
      expect(candidate).not.toHaveProperty("project");
      expect(candidate).not.toHaveProperty("ranking");
    }
  });

  it("uses Codex session metadata for current-project ranking", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const currentProjectRoot = join(tmp, "projects", "current-app");
    const otherProjectRoot = join(tmp, "projects", "other-app");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(currentProjectRoot, { recursive: true });
    await mkdir(otherProjectRoot, { recursive: true });
    const currentProjectPath = join(codexRoot, "2026-05-31-a.jsonl");
    const unrelatedFreshPath = join(codexRoot, "2026-05-31-b.jsonl");
    await writeSessionFile(
      currentProjectPath,
      `${JSON.stringify({
        type: "session_meta",
        payload: { cwd: currentProjectRoot },
      })}\n`,
      23 * 60 * 60 * 1000
    );
    await writeSessionFile(
      unrelatedFreshPath,
      `${JSON.stringify({
        type: "session_meta",
        payload: { cwd: otherProjectRoot },
      })}\n`,
      30 * 60 * 1000
    );
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: unrelatedFreshPath,
                  line: 2,
                  content: "fresh unrelated",
                  pattern: input.patterns[0],
                },
                ...Array.from({ length: 3 }, (_, index) => ({
                  source: source.name,
                  root: source.root,
                  path: currentProjectPath,
                  line: index + 2,
                  content: `current project ${index + 1}`,
                  pattern: input.patterns[0],
                })),
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      debug: true,
      operationalContext: { cwd: currentProjectRoot },
    });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual([
      join(canonicalCodexRoot, "2026-05-31-a.jsonl"),
      join(canonicalCodexRoot, "2026-05-31-b.jsonl"),
    ]);
    expect(result.debug?.ranking?.candidates[0]).toMatchObject({
      path: join(canonicalCodexRoot, "2026-05-31-a.jsonl"),
      projectMatch: "path",
      projectPoints: 2,
    });
  });

  it("uses Codex JSONL metadata from configured archive source names for current-project ranking", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const archiveRoot = join(tmp, "codex-archive");
    const currentProjectRoot = join(tmp, "projects", "current-app");
    const otherProjectRoot = join(tmp, "projects", "other-app");
    const configPath = join(tmp, "config.json");
    await mkdir(archiveRoot);
    await mkdir(currentProjectRoot, { recursive: true });
    await mkdir(otherProjectRoot, { recursive: true });
    const currentProjectPath = join(
      archiveRoot,
      "rollout-2026-05-19T08-13-59-019e3f4c-81e2-75a0-a125-8ea2ea42dd9f.jsonl"
    );
    const unrelatedFreshPath = join(
      archiveRoot,
      "rollout-2026-05-19T21-18-43-019e421a-f5fb-73b3-9d32-41f99f621639.jsonl"
    );
    await writeSessionFile(
      currentProjectPath,
      `${JSON.stringify({
        type: "session_meta",
        payload: { cwd: currentProjectRoot },
      })}\n`,
      23 * 60 * 60 * 1000
    );
    await writeSessionFile(
      unrelatedFreshPath,
      `${JSON.stringify({
        type: "session_meta",
        payload: { cwd: otherProjectRoot },
      })}\n`,
      30 * 60 * 1000
    );
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex_archive", path: archiveRoot, include: ["*.jsonl"] },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: unrelatedFreshPath,
                  line: 2,
                  content: "fresh unrelated archive",
                  pattern: input.patterns[0],
                },
                ...Array.from({ length: 3 }, (_, index) => ({
                  source: source.name,
                  root: source.root,
                  path: currentProjectPath,
                  line: index + 2,
                  content: `current archive project ${index + 1}`,
                  pattern: input.patterns[0],
                })),
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      debug: true,
      operationalContext: { cwd: currentProjectRoot },
    });
    const canonicalArchiveRoot = await realpath(archiveRoot);

    expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual([
      join(
        canonicalArchiveRoot,
        "rollout-2026-05-19T08-13-59-019e3f4c-81e2-75a0-a125-8ea2ea42dd9f.jsonl"
      ),
      join(
        canonicalArchiveRoot,
        "rollout-2026-05-19T21-18-43-019e421a-f5fb-73b3-9d32-41f99f621639.jsonl"
      ),
    ]);
    expect(result.debug?.ranking?.candidates[0]).toMatchObject({
      source: "codex_archive",
      path: join(
        canonicalArchiveRoot,
        "rollout-2026-05-19T08-13-59-019e3f4c-81e2-75a0-a125-8ea2ea42dd9f.jsonl"
      ),
      projectMatch: "path",
      projectPoints: 2,
    });
  });

  it("uses Pi session metadata for current-project ranking", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const piRoot = join(tmp, "pi");
    const currentProjectRoot = join(tmp, "projects", "current-app");
    const configPath = join(tmp, "config.json");
    await mkdir(piRoot);
    await mkdir(currentProjectRoot, { recursive: true });
    const currentProjectPath = join(piRoot, "20260531_aaa.jsonl");
    const unrelatedFreshPath = join(piRoot, "20260531_bbb.jsonl");
    await writeSessionFile(
      currentProjectPath,
      `${JSON.stringify({
        type: "session",
        id: "aaa",
        cwd: currentProjectRoot,
      })}\n`,
      23 * 60 * 60 * 1000
    );
    await writeSessionFile(
      unrelatedFreshPath,
      `${JSON.stringify({
        type: "session",
        id: "bbb",
        cwd: join(tmp, "projects", "other-app"),
      })}\n`,
      30 * 60 * 1000
    );
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "pi", path: piRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: unrelatedFreshPath,
                  line: 2,
                  content: "fresh unrelated",
                  pattern: input.patterns[0],
                },
                ...Array.from({ length: 3 }, (_, index) => ({
                  source: source.name,
                  root: source.root,
                  path: currentProjectPath,
                  line: index + 2,
                  content: `current project ${index + 1}`,
                  pattern: input.patterns[0],
                })),
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      debug: true,
      operationalContext: { cwd: currentProjectRoot },
    });
    const canonicalPiRoot = await realpath(piRoot);

    expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual([
      join(canonicalPiRoot, "20260531_aaa.jsonl"),
      join(canonicalPiRoot, "20260531_bbb.jsonl"),
    ]);
    expect(result.debug?.ranking?.candidates[0]).toMatchObject({
      source: "pi",
      path: join(canonicalPiRoot, "20260531_aaa.jsonl"),
      projectMatch: "path",
      projectPoints: 2,
    });
  });

  it("lets materially stronger cross-project candidates beat the project boost", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const currentProjectRoot = join(tmp, "projects", "current-app");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(currentProjectRoot, { recursive: true });
    await mkdir(join(codexRoot, "current-app"));
    await mkdir(join(codexRoot, "other-app"));
    const currentProjectPath = join(codexRoot, "current-app", "session.jsonl");
    const strongOtherPath = join(codexRoot, "other-app", "session.jsonl");
    await touchFile(currentProjectPath, 23 * 60 * 60 * 1000);
    await touchFile(strongOtherPath, 30 * 60 * 1000);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: currentProjectPath,
                  line: 1,
                  content: "current project",
                  pattern: input.patterns[0],
                },
                ...Array.from({ length: 10 }, (_, index) => ({
                  source: source.name,
                  root: source.root,
                  path: strongOtherPath,
                  line: index + 1,
                  content: `strong other ${index + 1}`,
                  pattern: input.patterns[0],
                })),
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      operationalContext: { cwd: currentProjectRoot },
    });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual([
      join(canonicalCodexRoot, "other-app", "session.jsonl"),
      join(canonicalCodexRoot, "current-app", "session.jsonl"),
    ]);
  });

  it("preserves core ranking for malformed or unrelated project context", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(join(codexRoot, "current-app"));
    await mkdir(join(codexRoot, "other-app"));
    const staleCurrentPath = join(codexRoot, "current-app", "session.jsonl");
    const freshOtherPath = join(codexRoot, "other-app", "session.jsonl");
    await touchFile(staleCurrentPath, 23 * 60 * 60 * 1000);
    await touchFile(freshOtherPath, 30 * 60 * 1000);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: staleCurrentPath,
                  line: 1,
                  content: "stale current-looking path",
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: freshOtherPath,
                  line: 1,
                  content: "fresh other path",
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      operationalContext: { cwd: 42, repo: "unrelated-project" },
    });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual([
      join(canonicalCodexRoot, "other-app", "session.jsonl"),
      join(canonicalCodexRoot, "current-app", "session.jsonl"),
    ]);
  });

  it("does not boost generic project context tokens", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(join(codexRoot, "node_modules"));
    await mkdir(join(codexRoot, "other-app"));
    const genericPath = join(codexRoot, "node_modules", "session.jsonl");
    const freshOtherPath = join(codexRoot, "other-app", "session.jsonl");
    await touchFile(genericPath, 23 * 60 * 60 * 1000);
    await touchFile(freshOtherPath, 30 * 60 * 1000);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: genericPath,
                  line: 1,
                  content: "generic token path",
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: freshOtherPath,
                  line: 1,
                  content: "fresh other path",
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      operationalContext: { cwd: "/home/data/projects/node_modules" },
    });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual([
      join(canonicalCodexRoot, "other-app", "session.jsonl"),
      join(canonicalCodexRoot, "node_modules", "session.jsonl"),
    ]);
  });

  it("explains candidate ranking when candidates are requested with debug", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    const currentSessionId = "019dd9cf-08bd-7580-827e-870084b36b6a";
    const historicalPath = join(codexRoot, "current-app", "historical.jsonl");
    const currentPath = join(
      codexRoot,
      "current-app",
      `rollout-2026-04-29T10-15-17-${currentSessionId}.jsonl`
    );
    await mkdir(join(codexRoot, "current-app"), { recursive: true });
    await touchFile(historicalPath, 30 * 60 * 1000);
    await touchFile(currentPath, 30 * 60 * 1000);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const previousThreadId = process.env.CODEX_THREAD_ID;
    process.env.CODEX_THREAD_ID = currentSessionId;
    try {
      const search = createSessionSearch({
        configPath,
        defaultRoots: [],
        createBackend(source) {
          return {
            async search(input) {
              return {
                warnings: [],
                results: [
                  ...Array.from({ length: 10 }, (_, index) => ({
                    source: source.name,
                    root: source.root,
                    path: currentPath,
                    line: index + 1,
                    content: `current match ${index + 1}`,
                    pattern: input.patterns[0],
                  })),
                  ...Array.from({ length: 3 }, (_, index) => ({
                    source: source.name,
                    root: source.root,
                    path: historicalPath,
                    line: index + 1,
                    content: `historical match ${index + 1}`,
                    pattern: input.patterns[0],
                  })),
                ],
              };
            },
          };
        },
      });

      const result = await search.searchSessions({
        query: "auth token timeout",
        resultsDisplayMode: "candidates",
        debug: true,
        operationalContext: { repo: "current-app" },
      });
      const canonicalCodexRoot = await realpath(codexRoot);
      const canonicalHistoricalPath = join(
        canonicalCodexRoot,
        "current-app",
        "historical.jsonl"
      );
      const canonicalCurrentPath = join(
        canonicalCodexRoot,
        "current-app",
        `rollout-2026-04-29T10-15-17-${currentSessionId}.jsonl`
      );

      expect(result.resultsDisplayMode).toBe("candidates");
      expect(result.resultsShape).toBe("candidate_groups");
      expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual(
        [canonicalHistoricalPath, canonicalCurrentPath]
      );
      expect(result.debug?.ranking?.candidates).toHaveLength(2);
      expect(result.debug?.ranking?.candidates[0]).toMatchObject({
        rank: 1,
        source: "codex",
        path: canonicalHistoricalPath,
        hitCount: 3,
        originalIndex: 1,
        isCurrentSession: false,
        mtimeMs: expect.any(Number),
        recencyBucket: "lt_2h",
        recencyPoints: 4,
        densityPoints: 2,
        projectMatch: "repo_token",
        projectPoints: 2,
        score: 12,
      });
      expect(result.debug?.ranking?.candidates[1]).toMatchObject({
        rank: 2,
        source: "codex",
        path: canonicalCurrentPath,
        sessionId: currentSessionId,
        hitCount: 10,
        originalIndex: 0,
        isCurrentSession: true,
        mtimeMs: expect.any(Number),
        recencyBucket: "lt_2h",
        recencyPoints: 4,
        projectMatch: "repo_token",
        projectPoints: 2,
      });
      expect(result.debug?.ranking?.candidates[1]?.densityPoints).toBeCloseTo(
        Math.log2(11)
      );
      expect(result.debug?.ranking?.candidates[1]?.score).toBeCloseTo(
        8 + Math.log2(11) + 2
      );
      for (const entry of result.debug?.ranking?.candidates ?? []) {
        expect(entry).not.toHaveProperty("content");
        expect(entry).not.toHaveProperty("preview");
        expect(entry).not.toHaveProperty("snippets");
      }
    } finally {
      if (previousThreadId === undefined) {
        delete process.env.CODEX_THREAD_ID;
      } else {
        process.env.CODEX_THREAD_ID = previousThreadId;
      }
    }
  });

  it("keeps non-debug candidates score-free after ranking explanations exist", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await touchFile(join(codexRoot, "session.jsonl"), 30 * 60 * 1000);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "session.jsonl"),
                  line: 1,
                  content: "plain candidate",
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
    });

    expect(result.debug).toBeUndefined();
    expect(candidateLeads(result)[0]).not.toHaveProperty("score");
    expect(candidateLeads(result)[0]).not.toHaveProperty("mtimeMs");
    expect(candidateLeads(result)[0]).not.toHaveProperty("ranking");
  });

  it("keeps malformed context and missing mtimes non-fatal in ranking debug", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "missing-a.jsonl"),
                  line: 1,
                  content: "first missing path",
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "missing-b.jsonl"),
                  line: 1,
                  content: "second missing path",
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      debug: true,
      operationalContext: { cwd: 42, projectRoot: ["bad"] },
    });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(result.warnings).toEqual([]);
    expect(candidateLeads(result).map((candidate) => candidate.path)).toEqual([
      join(canonicalCodexRoot, "missing-a.jsonl"),
      join(canonicalCodexRoot, "missing-b.jsonl"),
    ]);
    expect(result.debug?.ranking?.candidates).toEqual([
      {
        rank: 1,
        source: "codex",
        path: join(canonicalCodexRoot, "missing-a.jsonl"),
        hitCount: 1,
        patternMatchCount: 1,
        originalIndex: 0,
        isCurrentSession: false,
        recencyBucket: "older_or_missing",
        recencyPoints: 0,
        densityPoints: 1,
        projectMatch: "none",
        projectPoints: 0,
        score: 1,
        strongestGroup: {
          id: "exact_or_structured",
          priority: 0,
          patternIds: ["p1"],
        },
        groupMemberships: [
          {
            id: "exact_or_structured",
            priority: 0,
            patternIds: ["p1"],
          },
        ],
      },
      {
        rank: 2,
        source: "codex",
        path: join(canonicalCodexRoot, "missing-b.jsonl"),
        hitCount: 1,
        patternMatchCount: 1,
        originalIndex: 1,
        isCurrentSession: false,
        recencyBucket: "older_or_missing",
        recencyPoints: 0,
        densityPoints: 1,
        projectMatch: "none",
        projectPoints: 0,
        score: 1,
        strongestGroup: {
          id: "exact_or_structured",
          priority: 0,
          patternIds: ["p1"],
        },
        groupMemberships: [
          {
            id: "exact_or_structured",
            priority: 0,
            patternIds: ["p1"],
          },
        ],
      },
    ]);
  });

  it("groups unscoped evidence by session path with scoped follow-ups", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot, include: ["*.jsonl"] }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search() {
            const sessionPath = join(source.root, "session-a.jsonl");
            const otherPath = join(source.root, "session-b.jsonl");
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: sessionPath,
                  line: 12,
                  content: "Discussed PR #205 as the Linear reference",
                  pattern: "PR #205",
                },
                {
                  source: source.name,
                  root: source.root,
                  path: sessionPath,
                  line: 44,
                  content: "Use pull/205 for the canonical branch",
                  pattern: "pull/205",
                },
                {
                  source: source.name,
                  root: source.root,
                  path: otherPath,
                  line: 3,
                  content: "Mentioned PR #205 while triaging another issue",
                  pattern: "PR #205",
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "PR #205 Linear",
      queries: ["PR #205", "Linear"],
      sources: ["codex"],
      resultsDisplayMode: "evidence",
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalSessionPath = join(canonicalCodexRoot, "session-a.jsonl");
    const canonicalOtherPath = join(canonicalCodexRoot, "session-b.jsonl");

    expect(result.resultsShape).toBe("evidence_groups");
    expect(candidateLeads(result)).toMatchObject([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: canonicalSessionPath,
        hitCount: 2,
        matchedQueries: ["PR #205"],
        matchedPatterns: ["PR #205", "pull/205"],
        snippets: [
          {
            line: 12,
            content: "Discussed PR #205 as the Linear reference",
            pattern: "PR #205",
            query: "PR #205",
          },
          {
            line: 44,
            content: "Use pull/205 for the canonical branch",
            pattern: "pull/205",
            query: "PR #205",
          },
        ],
        more: {
          evidence: {
            query: "PR #205 Linear",
            queries: ["PR #205", "Linear"],
            sources: ["codex"],
            resultsDisplayMode: "evidence",
            paths: [canonicalSessionPath],
          },
        },
      },
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: canonicalOtherPath,
        hitCount: 1,
        matchedQueries: ["PR #205"],
        matchedPatterns: ["PR #205"],
        snippets: [
          {
            line: 3,
            content: "Mentioned PR #205 while triaging another issue",
            pattern: "PR #205",
            query: "PR #205",
          },
        ],
        more: {
          evidence: {
            query: "PR #205 Linear",
            queries: ["PR #205", "Linear"],
            sources: ["codex"],
            resultsDisplayMode: "evidence",
            paths: [canonicalOtherPath],
          },
        },
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps evidence group order unchanged by candidate ranking", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    const olderDensePath = join(codexRoot, "older-dense.jsonl");
    const freshSparsePath = join(codexRoot, "fresh-sparse.jsonl");
    await touchFile(olderDensePath, 3 * 60 * 60 * 1000);
    await touchFile(freshSparsePath, 30 * 60 * 1000);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: freshSparsePath,
                  line: 1,
                  content: "fresh sparse",
                  pattern: input.patterns[0],
                },
                ...Array.from({ length: 8 }, (_, index) => ({
                  source: source.name,
                  root: source.root,
                  path: olderDensePath,
                  line: index + 1,
                  content: `older dense ${index + 1}`,
                  pattern: input.patterns[0],
                })),
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
    });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(result.resultsShape).toBe("evidence_groups");
    expect(result.results.map((group) => group.path)).toEqual([
      join(canonicalCodexRoot, "fresh-sparse.jsonl"),
      join(canonicalCodexRoot, "older-dense.jsonl"),
    ]);
  });

  it("keeps unscoped evidence groups separate for different sources with the same path", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const sharedRoot = join(tmp, "shared");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await mkdir(sharedRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot },
          { name: "claude", path: claudeRoot },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search() {
            const sessionPath = join(sharedRoot, "same-session.jsonl");
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: sessionPath,
                  line: source.name === "codex" ? 10 : 20,
                  content: `${source.name} saw retry timeout`,
                  pattern: "retry timeout",
                },
                {
                  source: source.name,
                  root: source.root,
                  path: sessionPath,
                  line: source.name === "codex" ? 11 : 21,
                  content: `${source.name} kept source metadata`,
                  pattern: "source metadata",
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "retry timeout source metadata",
      queries: ["retry timeout", "source metadata"],
      resultsDisplayMode: "evidence",
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalClaudeRoot = await realpath(claudeRoot);
    const canonicalSessionPath = join(
      await realpath(sharedRoot),
      "same-session.jsonl"
    );

    expect(result.resultsShape).toBe("evidence_groups");
    expect(candidateLeads(result)).toMatchObject([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: canonicalSessionPath,
        hitCount: 2,
        matchedQueries: ["retry timeout", "source metadata"],
        matchedPatterns: ["retry timeout", "source metadata"],
        snippets: [
          {
            line: 10,
            content: "codex saw retry timeout",
            pattern: "retry timeout",
            query: "retry timeout",
          },
          {
            line: 11,
            content: "codex kept source metadata",
            pattern: "source metadata",
            query: "source metadata",
          },
        ],
        more: {
          evidence: {
            query: "retry timeout source metadata",
            queries: ["retry timeout", "source metadata"],
            sources: ["codex"],
            resultsDisplayMode: "evidence",
            paths: [canonicalSessionPath],
          },
        },
      },
      {
        source: "claude",
        root: canonicalClaudeRoot,
        path: canonicalSessionPath,
        hitCount: 2,
        matchedQueries: ["retry timeout", "source metadata"],
        matchedPatterns: ["retry timeout", "source metadata"],
        snippets: [
          {
            line: 20,
            content: "claude saw retry timeout",
            pattern: "retry timeout",
            query: "retry timeout",
          },
          {
            line: 21,
            content: "claude kept source metadata",
            pattern: "source metadata",
            query: "source metadata",
          },
        ],
        more: {
          evidence: {
            query: "retry timeout source metadata",
            queries: ["retry timeout", "source metadata"],
            sources: ["claude"],
            resultsDisplayMode: "evidence",
            paths: [canonicalSessionPath],
          },
        },
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("restricts evidence results to selected session paths", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot, include: ["*.jsonl"] }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "selected.jsonl"),
                  line: 7,
                  content: `selected ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "other.jsonl"),
                  line: 9,
                  content: `other ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const selectedPath = join(canonicalCodexRoot, "selected.jsonl");

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      paths: [selectedPath],
    });

    expect(result.resultsShape).toBe("evidence_hits");
    expect(result.results).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: selectedPath,
        line: 7,
        content: "selected auth token timeout",
        pattern: "auth token timeout",
        query: "auth token timeout",
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("does not lose path-restricted evidence behind the normal result cap", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot, include: ["*.jsonl"] }],
        defaults: { maxResultsPerSource: 1 },
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push(input);
            const results = [
              {
                source: source.name,
                root: source.root,
                path: join(source.root, "other.jsonl"),
                line: 1,
                content: "other auth token timeout",
                pattern: input.patterns[0],
              },
              ...[2, 3, 4].map((line) => ({
                source: source.name,
                root: source.root,
                path: join(source.root, "selected.jsonl"),
                line,
                content: `selected ${line} auth token timeout`,
                pattern: input.patterns[0],
              })),
            ];
            return {
              warnings: [],
              results:
                input.maxResults === undefined
                  ? results
                  : results.slice(0, input.maxResults),
            };
          },
        };
      },
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const selectedPath = join(canonicalCodexRoot, "selected.jsonl");

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      paths: [selectedPath],
    });

    expect(calls).toEqual([
      {
        patterns: AUTH_TOKEN_TIMEOUT_PATTERNS,
        maxResults: undefined,
        context: undefined,
        paths: [selectedPath],
        include: ["*.jsonl"],
      },
    ]);
    expect(result.resultsShape).toBe("evidence_hits");
    expect(result.results).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: selectedPath,
        line: 2,
        content: "selected 2 auth token timeout",
        pattern: "auth token timeout",
        query: "auth token timeout",
      },
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: selectedPath,
        line: 3,
        content: "selected 3 auth token timeout",
        pattern: "auth token timeout",
        query: "auth token timeout",
      },
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: selectedPath,
        line: 4,
        content: "selected 4 auth token timeout",
        pattern: "auth token timeout",
        query: "auth token timeout",
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("defers backend cap before active filters so a later eligible hit survives", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const workspace = join(codexRoot, "eligible-workspace");
    const configPath = join(tmp, "config.json");
    await mkdir(workspace, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({ roots: [{ name: "codex", path: codexRoot }] })
    );
    const ineligiblePath = join(codexRoot, "other-workspace.jsonl");
    const eligiblePath = join(workspace, "eligible.jsonl");
    await writeFile(ineligiblePath, "old");
    await writeFile(eligiblePath, "eligible");

    const calls: Array<{ maxResults?: number }> = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push(input);
            const results = [
              {
                source: source.name,
                root: source.root,
                path: ineligiblePath,
                line: 1,
                content: "ineligible auth token timeout",
                pattern: input.patterns[0],
              },
              {
                source: source.name,
                root: source.root,
                path: eligiblePath,
                line: 2,
                content: "eligible auth token timeout",
                pattern: input.patterns[0],
              },
            ];
            return {
              warnings: [],
              results:
                input.maxResults === undefined
                  ? results
                  : results.slice(0, input.maxResults),
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      maxResultsPerSource: 1,
      workspace,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.maxResults).toBeUndefined();
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ path: eligiblePath });
  });

  it("applies days in evidence and candidates while preserving the filter-less control", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({ roots: [{ name: "codex", path: codexRoot }] })
    );
    const currentTime = Date.now();
    const oldPath = join(codexRoot, "old.jsonl");
    const missingPath = join(codexRoot, "missing.jsonl");
    await writeFile(oldPath, "old auth token timeout");
    const oldTime = new Date(currentTime - 90 * 86_400_000);
    await utimes(oldPath, oldTime, oldTime);

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      now: () => currentTime,
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [oldPath, missingPath].map((path, index) => ({
                source: source.name,
                root: source.root,
                path,
                line: index + 1,
                content: `match ${index + 1}`,
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const control = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
    });
    const evidence = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      days: 30,
    });
    const candidates = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      days: 30,
    });

    expect(control.results).toHaveLength(2);
    expect(evidence.results).toEqual([]);
    expect(candidateLeads(candidates)).toEqual([]);
  });

  it("samples the cutoff clock once and shares the inclusive boundary across sources", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot },
          { name: "claude", path: claudeRoot },
        ],
      })
    );
    const currentTime = Date.now();
    const cutoff = currentTime - 86_400_000;
    const boundaryPath = join(codexRoot, "boundary.jsonl");
    const beforePath = join(claudeRoot, "before.jsonl");
    await writeFile(boundaryPath, "boundary");
    await writeFile(beforePath, "before");
    await utimes(boundaryPath, new Date(cutoff), new Date(cutoff));
    await utimes(beforePath, new Date(cutoff - 1), new Date(cutoff - 1));
    let nowCalls = 0;

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      now: () => {
        nowCalls += 1;
        return currentTime;
      },
      createBackend(source) {
        return {
          async search(input) {
            const path = source.name === "codex" ? boundaryPath : beforePath;
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path,
                  line: 1,
                  content: "auth token timeout",
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      sources: ["codex", "claude"],
      days: 1,
    });

    expect(nowCalls).toBe(1);
    expect(result.results.map((entry) => entry.path)).toEqual([boundaryPath]);
  });

  it("workspace matches direct encoded and metadata lanes without sibling prefixes", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const workspace = join(tmp, "workspace");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(workspace);
    await writeFile(
      configPath,
      JSON.stringify({ roots: [{ name: "codex", path: codexRoot }] })
    );
    const encoded = workspace.replace(/[^a-zA-Z0-9]/g, "-");
    const paths = {
      direct: join(workspace, "direct.jsonl"),
      claude: join(codexRoot, "claude", encoded, "claude.jsonl"),
      ompWrapped: join(codexRoot, "omp-wrapped", `-${encoded}-`, "omp.jsonl"),
      ompBare: join(codexRoot, "omp-bare", encoded, "omp.jsonl"),
      metadata: join(codexRoot, "metadata", "metadata.jsonl"),
      sibling: join(codexRoot, "claude", `${encoded}-extra`, "sibling.jsonl"),
    };
    for (const path of Object.values(paths)) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        path === paths.metadata ? `${JSON.stringify({ cwd: workspace })}\n` : ""
      );
    }

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: Object.values(paths).map((path, index) => ({
                source: source.name,
                root: source.root,
                path,
                line: index + 1,
                content: `match ${index + 1}`,
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      workspace,
    });

    expect(result.results.map((entry) => entry.path)).toEqual([
      paths.direct,
      paths.claude,
      paths.ompWrapped,
      paths.ompBare,
      paths.metadata,
    ]);
  });

  it("combined days and workspace preserve survivor ranking neutrality", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const workspace = join(tmp, "workspace");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(workspace);
    await writeFile(
      configPath,
      JSON.stringify({ roots: [{ name: "codex", path: codexRoot }] })
    );
    const currentTime = Date.now();
    const paths = {
      newest: join(workspace, "newest.jsonl"),
      recent: join(workspace, "recent.jsonl"),
      stale: join(workspace, "stale.jsonl"),
      external: join(codexRoot, "external.jsonl"),
    };
    for (const path of Object.values(paths)) {
      await writeFile(path, "auth token timeout");
    }
    await utimes(paths.newest, new Date(currentTime), new Date(currentTime));
    await utimes(
      paths.recent,
      new Date(currentTime - 3 * 86_400_000),
      new Date(currentTime - 3 * 86_400_000)
    );
    await utimes(
      paths.stale,
      new Date(currentTime - 90 * 86_400_000),
      new Date(currentTime - 90 * 86_400_000)
    );
    await utimes(paths.external, new Date(currentTime), new Date(currentTime));

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      now: () => currentTime,
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: Object.values(paths).map((path, index) => ({
                source: source.name,
                root: source.root,
                path,
                line: index + 1,
                content: "auth token timeout",
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const control = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      debug: true,
    });
    const filtered = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "candidates",
      debug: true,
      days: 30,
      workspace,
    });
    const expectedSurvivorOrder =
      control.debug?.ranking?.candidates
        .map(({ path }) => path)
        .filter((path) => path === paths.newest || path === paths.recent) ?? [];

    expect(filtered.debug?.ranking?.candidates.map(({ path }) => path)).toEqual(
      expectedSurvivorOrder
    );
    for (const entry of filtered.debug?.ranking?.candidates ?? []) {
      expect(entry).not.toHaveProperty("days");
      expect(entry).not.toHaveProperty("workspace");
      expect(entry).not.toHaveProperty("filters");
      expect(entry).not.toHaveProperty("cutoff");
    }
  });

  it("preserves partial source success alongside workspace-filtered survivors", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const workspace = join(codexRoot, "workspace");
    const configPath = join(tmp, "config.json");
    await mkdir(workspace, { recursive: true });
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot },
          { name: "claude", path: claudeRoot },
        ],
      })
    );
    const eligiblePath = join(workspace, "eligible.jsonl");
    await writeFile(eligiblePath, "auth token timeout");

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            if (source.name === "claude") {
              throw new Error("claude backend unavailable");
            }
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: eligiblePath,
                  line: 1,
                  content: "auth token timeout",
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      sources: ["codex", "claude"],
      workspace,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ path: eligiblePath });
    expect(result.searchedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "codex", status: "ok" }),
        expect.objectContaining({ name: "claude", status: "failed" }),
      ])
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "claude",
          code: "source_search_failed",
        }),
      ])
    );
  });

  it("warns once when active filters remove every eligible result", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const workspace = join(tmp, "workspace");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(workspace);
    await writeFile(
      configPath,
      JSON.stringify({ roots: [{ name: "codex", path: codexRoot }] })
    );
    const currentTime = Date.now();
    const oldPath = join(workspace, "old.jsonl");
    await writeFile(oldPath, "auth token timeout");
    const oldTime = new Date(currentTime - 90 * 86_400_000);
    await utimes(oldPath, oldTime, oldTime);
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      now: () => currentTime,
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: oldPath,
                  line: 1,
                  content: "auth token timeout",
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      days: 30,
      workspace,
    });
    const filterWarnings = result.warnings.filter(
      ({ code }) => code === "filters_removed_all_results"
    );

    expect(result.results).toEqual([]);
    expect(filterWarnings).toHaveLength(1);
    expect(result.metadata.filters).toEqual({ days: 30, workspace });
  });

  it("filters_removed_all_results recommends the observed days workspace and stat remedies", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const workspace = join(tmp, "workspace");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(workspace);
    await writeFile(
      configPath,
      JSON.stringify({ roots: [{ name: "codex", path: codexRoot }] })
    );
    const currentTime = Date.now();
    const oldPath = join(codexRoot, "old.jsonl");
    const outsidePath = join(codexRoot, "outside.jsonl");
    const missingPath = join(codexRoot, "missing.jsonl");
    await writeFile(oldPath, "old");
    await writeFile(outsidePath, "outside");
    const oldTime = new Date(currentTime - 90 * 86_400_000);
    await utimes(oldPath, oldTime, oldTime);

    const run = async (
      path: string,
      filters: { days?: number; workspace?: string }
    ) => {
      const search = createSessionSearch({
        configPath,
        defaultRoots: [],
        now: () => currentTime,
        createBackend(source) {
          return {
            async search(input) {
              return {
                warnings: [],
                results: [
                  {
                    source: source.name,
                    root: source.root,
                    path,
                    line: 1,
                    content: "auth token timeout",
                    pattern: input.patterns[0],
                  },
                ],
              };
            },
          };
        },
      });
      const result = await search.searchSessions({
        query: "auth token timeout",
        resultsDisplayMode: "evidence",
        ...filters,
      });
      return result.warnings.filter(
        ({ code }) => code === "filters_removed_all_results"
      );
    };

    const daysWarnings = await run(oldPath, { days: 30 });
    const workspaceWarnings = await run(outsidePath, { workspace });
    const statWarnings = await run(missingPath, { days: 30 });

    expect(daysWarnings).toHaveLength(1);
    expect(daysWarnings[0]?.recommendedAction).toBe(
      "Widen days to include older session files."
    );
    expect(workspaceWarnings).toHaveLength(1);
    expect(workspaceWarnings[0]?.recommendedAction).toBe(
      "Verify or widen workspace to include the intended sessions."
    );
    expect(statWarnings).toHaveLength(1);
    expect(statWarnings[0]?.recommendedAction).toBe(
      "Verify session-file readability and mtime availability."
    );
  });

  it("filter metadata and empty warnings stay absent for negative controls", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    const includeConfigPath = join(tmp, "include-config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({ roots: [{ name: "codex", path: codexRoot }] })
    );
    await writeFile(
      includeConfigPath,
      JSON.stringify({
        roots: [
          {
            name: "codex",
            path: codexRoot,
            include: ["sessions/*.jsonl"],
          },
        ],
      })
    );
    const currentTime = Date.now();
    const recentPath = join(codexRoot, "recent.jsonl");
    const oldPath = join(codexRoot, "old.jsonl");
    const excludedPath = join(codexRoot, "logs", "excluded.jsonl");
    await mkdir(dirname(excludedPath), { recursive: true });
    await writeFile(recentPath, "recent");
    await writeFile(oldPath, "old");
    await writeFile(excludedPath, "excluded");
    const oldTime = new Date(currentTime - 90 * 86_400_000);
    await utimes(oldPath, oldTime, oldTime);

    const createSearch = (
      paths: string[],
      options: { config?: string; fail?: boolean } = {}
    ) =>
      createSessionSearch({
        configPath: options.config ?? configPath,
        defaultRoots: [],
        now: () => currentTime,
        createBackend(source) {
          return {
            async search(input) {
              if (options.fail) throw new Error("backend unavailable");
              return {
                warnings: [],
                results: paths.map((path, index) => ({
                  source: source.name,
                  root: source.root,
                  path,
                  line: index + 1,
                  content: "auth token timeout",
                  pattern: input.patterns[0],
                })),
              };
            },
          };
        },
      });
    const searchInput = {
      query: "auth token timeout",
      resultsDisplayMode: "evidence" as const,
    };

    const lexicalZero = await createSearch([]).searchSessions({
      ...searchInput,
      days: 30,
    });
    const sourceFailure = await createSearch([], { fail: true }).searchSessions(
      {
        ...searchInput,
        days: 30,
      }
    );
    const includeOnly = await createSearch([excludedPath], {
      config: includeConfigPath,
    }).searchSessions({ ...searchInput, days: 30 });
    const partial = await createSearch([oldPath, recentPath]).searchSessions({
      ...searchInput,
      days: 30,
    });
    const filterless = await createSearch([]).searchSessions(searchInput);

    for (const result of [
      lexicalZero,
      sourceFailure,
      includeOnly,
      partial,
      filterless,
    ]) {
      expect(
        result.warnings.some(
          ({ code }) => code === "filters_removed_all_results"
        )
      ).toBe(false);
    }
    expect(partial.results).toHaveLength(1);
    expect(filterless.metadata).not.toHaveProperty("filters");
  });

  it("nonexistent workspace resolves with canonical filter metadata and one warning", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const nonexistentWorkspace = join(tmp, "missing-workspace");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({ roots: [{ name: "codex", path: codexRoot }] })
    );
    const hitPath = join(codexRoot, "hit.jsonl");
    await writeFile(hitPath, "auth token timeout");
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: hitPath,
                  line: 1,
                  content: "auth token timeout",
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const pending = search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      workspace: nonexistentWorkspace,
    });

    await expect(pending).resolves.toMatchObject({
      results: [],
      metadata: { filters: { workspace: nonexistentWorkspace } },
    });
    const result = await pending;
    expect(
      result.warnings.filter(
        ({ code }) => code === "filters_removed_all_results"
      )
    ).toHaveLength(1);
  });

  it("filters_removed_all_results aggregates mixed sources into at most one warning", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot },
          { name: "claude", path: claudeRoot },
        ],
      })
    );
    const currentTime = Date.now();
    const codexOld = join(codexRoot, "old.jsonl");
    const claudeOld = join(claudeRoot, "old.jsonl");
    const claudeFresh = join(claudeRoot, "fresh.jsonl");
    for (const path of [codexOld, claudeOld, claudeFresh]) {
      await writeFile(path, "auth token timeout");
    }
    const oldTime = new Date(currentTime - 90 * 86_400_000);
    await utimes(codexOld, oldTime, oldTime);
    await utimes(claudeOld, oldTime, oldTime);

    const run = async (claudePath: string) => {
      const search = createSessionSearch({
        configPath,
        defaultRoots: [],
        now: () => currentTime,
        createBackend(source) {
          return {
            async search(input) {
              const path = source.name === "codex" ? codexOld : claudePath;
              return {
                warnings: [],
                results: [
                  {
                    source: source.name,
                    root: source.root,
                    path,
                    line: 1,
                    content: "auth token timeout",
                    pattern: input.patterns[0],
                  },
                ],
              };
            },
          };
        },
      });
      return search.searchSessions({
        query: "auth token timeout",
        resultsDisplayMode: "evidence",
        sources: ["codex", "claude"],
        days: 30,
      });
    };

    const partial = await run(claudeFresh);
    const empty = await run(claudeOld);

    expect(partial.results).toHaveLength(1);
    expect(
      partial.warnings.some(
        ({ code }) => code === "filters_removed_all_results"
      )
    ).toBe(false);
    expect(empty.results).toEqual([]);
    expect(
      empty.warnings.filter(
        ({ code }) => code === "filters_removed_all_results"
      )
    ).toHaveLength(1);
  });

  it("does not lose include-filtered evidence behind the unscoped evidence cap", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(configPath, JSON.stringify({}));

    const include = ["sessions/*.jsonl", "archived_sessions/*.jsonl"];
    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [{ name: "codex", path: codexRoot, include }],
      createBackend(source) {
        return {
          async search(input) {
            calls.push(input);
            const results = [
              ...Array.from({ length: 20 }, (_, index) => ({
                source: source.name,
                root: source.root,
                path: join(source.root, "logs", `noise-${index}.json`),
                line: index + 1,
                content: `excluded auth token timeout ${index}`,
                pattern: input.patterns[0],
              })),
              {
                source: source.name,
                root: source.root,
                path: join(source.root, "sessions", "selected.jsonl"),
                line: 21,
                content: "selected auth token timeout",
                pattern: input.patterns[0],
              },
            ];
            return {
              warnings: [],
              results:
                input.maxResults === undefined
                  ? results
                  : results.slice(0, input.maxResults),
            };
          },
        };
      },
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const selectedPath = join(canonicalCodexRoot, "sessions", "selected.jsonl");

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
    });

    expect(calls).toEqual([
      {
        patterns: AUTH_TOKEN_TIMEOUT_PATTERNS,
        maxResults: undefined,
        context: undefined,
        include,
      },
    ]);
    expect(result.resultsShape).toBe("evidence_groups");
    expect(result.results).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: selectedPath,
        hitCount: 1,
        matchedQueries: ["auth token timeout"],
        matchedPatterns: ["auth token timeout"],
        snippets: [
          {
            line: 21,
            content: "selected auth token timeout",
            pattern: "auth token timeout",
            query: "auth token timeout",
          },
        ],
        more: {
          evidence: {
            query: "auth token timeout",
            sources: ["codex"],
            resultsDisplayMode: "evidence",
            paths: [selectedPath],
          },
        },
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("honors explicit result caps for path-restricted evidence", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot, include: ["*.jsonl"] }],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push(input);
            const results = [1, 2, 3].map((line) => ({
              source: source.name,
              root: source.root,
              path: join(source.root, "selected.jsonl"),
              line,
              content: `selected ${line} auth token timeout`,
              pattern: input.patterns[0],
            }));
            return {
              warnings: [],
              results:
                input.maxResults === undefined
                  ? results
                  : results.slice(0, input.maxResults),
            };
          },
        };
      },
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const selectedPath = join(canonicalCodexRoot, "selected.jsonl");

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      maxResultsPerSource: 2,
      paths: [selectedPath],
    });

    expect(calls).toEqual([
      {
        patterns: AUTH_TOKEN_TIMEOUT_PATTERNS,
        maxResults: undefined,
        context: undefined,
        paths: [selectedPath],
        include: ["*.jsonl"],
      },
    ]);
    expect(result.resultsShape).toBe("evidence_hits");
    expect(result.results).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: selectedPath,
        line: 1,
        content: "selected 1 auth token timeout",
        pattern: "auth token timeout",
        query: "auth token timeout",
      },
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: selectedPath,
        line: 2,
        content: "selected 2 auth token timeout",
        pattern: "auth token timeout",
        query: "auth token timeout",
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("filters results through configured include patterns", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const cursorRoot = join(tmp, "cursor");
    const configPath = join(tmp, "config.json");
    await mkdir(cursorRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          {
            name: "cursor",
            path: cursorRoot,
            include: [
              "*/agent-transcripts/**/*.jsonl",
              "*/agent-transcripts/**/*.json",
            ],
          },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(
                    source.root,
                    "SomeProject/agent-transcripts/session-123/session-123.jsonl"
                  ),
                  line: 2,
                  content: `allowed session ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(
                    source.root,
                    "SomeProject/agent-transcripts/session-123/subagents/child.jsonl"
                  ),
                  line: 4,
                  content: `allowed child ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(
                    source.root,
                    "SomeProject/agent-transcripts/session-123/metadata.json"
                  ),
                  line: 6,
                  content: `allowed json ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "project/logs/session.txt"),
                  line: 3,
                  content: `noise ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });
    const canonicalCursorRoot = await realpath(cursorRoot);

    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["cursor"],
      resultsDisplayMode: "evidence",
    });

    expect(result.results).toEqual([
      {
        source: "cursor",
        root: canonicalCursorRoot,
        path: join(
          canonicalCursorRoot,
          "SomeProject/agent-transcripts/session-123/session-123.jsonl"
        ),
        hitCount: 1,
        matchedQueries: ["auth token timeout"],
        matchedPatterns: ["auth token timeout"],
        snippets: [
          {
            line: 2,
            content: "allowed session auth token timeout",
            pattern: "auth token timeout",
            query: "auth token timeout",
          },
        ],
        more: {
          evidence: {
            query: "auth token timeout",
            sources: ["cursor"],
            resultsDisplayMode: "evidence",
            paths: [
              join(
                canonicalCursorRoot,
                "SomeProject/agent-transcripts/session-123/session-123.jsonl"
              ),
            ],
          },
        },
      },
      {
        source: "cursor",
        root: canonicalCursorRoot,
        path: join(
          canonicalCursorRoot,
          "SomeProject/agent-transcripts/session-123/subagents/child.jsonl"
        ),
        hitCount: 1,
        matchedQueries: ["auth token timeout"],
        matchedPatterns: ["auth token timeout"],
        snippets: [
          {
            line: 4,
            content: "allowed child auth token timeout",
            pattern: "auth token timeout",
            query: "auth token timeout",
          },
        ],
        more: {
          evidence: {
            query: "auth token timeout",
            sources: ["cursor"],
            resultsDisplayMode: "evidence",
            paths: [
              join(
                canonicalCursorRoot,
                "SomeProject/agent-transcripts/session-123/subagents/child.jsonl"
              ),
            ],
          },
        },
      },
      {
        source: "cursor",
        root: canonicalCursorRoot,
        path: join(
          canonicalCursorRoot,
          "SomeProject/agent-transcripts/session-123/metadata.json"
        ),
        hitCount: 1,
        matchedQueries: ["auth token timeout"],
        matchedPatterns: ["auth token timeout"],
        snippets: [
          {
            line: 6,
            content: "allowed json auth token timeout",
            pattern: "auth token timeout",
            query: "auth token timeout",
          },
        ],
        more: {
          evidence: {
            query: "auth token timeout",
            sources: ["cursor"],
            resultsDisplayMode: "evidence",
            paths: [
              join(
                canonicalCursorRoot,
                "SomeProject/agent-transcripts/session-123/metadata.json"
              ),
            ],
          },
        },
      },
    ]);
  });

  it("searches Pool history across its shared root", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const poolRoot = join(tmp, "poolside");
    const configPath = join(tmp, "config.json");
    await mkdir(poolRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          {
            name: "pool",
            path: poolRoot,
            include: [
              "trajectories/*.ndjson",
              "logs/*.log",
              "sessions/*.json",
              "acp/**/*.json",
            ],
          },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            const content = `pool hit ${input.patterns[0]}`;
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "trajectories/session.ndjson"),
                  line: 1,
                  content,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "logs/pool.log"),
                  line: 2,
                  content,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "sessions/session.json"),
                  line: 3,
                  content,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "acp/workspace/session.json"),
                  line: 4,
                  content,
                  pattern: input.patterns[0],
                },
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "cache/session.json"),
                  line: 5,
                  content: `filtered ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });
    const canonicalPoolRoot = await realpath(poolRoot);

    const result = await search.searchSessions({
      query: "pool smoke",
      sources: ["pool"],
      resultsDisplayMode: "evidence",
    });

    expect(result.results.map((hit) => hit.path)).toEqual([
      join(canonicalPoolRoot, "trajectories/session.ndjson"),
      join(canonicalPoolRoot, "logs/pool.log"),
      join(canonicalPoolRoot, "sessions/session.json"),
      join(canonicalPoolRoot, "acp/workspace/session.json"),
    ]);
  });

  it("uses agent-planned queries as the search probes while preserving the original request", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot, include: ["*.jsonl"] }],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push(input);
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "session.jsonl"),
                  line: 4,
                  content: "Done on paper-cuts / PR #227",
                  pattern: "PR #227",
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "use agent-session-search to find PR 227 and papercuts branch",
      queries: ["PR #227", "paper-cuts"],
      resultsDisplayMode: "evidence",
      debug: true,
    });

    expect(result.query).toBe(
      "use agent-session-search to find PR 227 and papercuts branch"
    );
    expect(result.resultsDisplayMode).toBe("evidence");
    expect(result.expandedPatterns).toEqual([
      "PR #227",
      "PR 227",
      "pull/227",
      "pull request 227",
      "#227",
      "227",
      "paper-cuts",
      "paper_cuts",
      "paperCuts",
    ]);
    expect(calls).toEqual([
      {
        patterns: result.expandedPatterns,
        maxResults: undefined,
        context: undefined,
        include: ["*.jsonl"],
      },
    ]);
    expect(result.results[0]).toMatchObject({
      hitCount: 1,
      matchedQueries: ["PR #227"],
      matchedPatterns: ["PR #227"],
      snippets: [
        {
          content: "Done on paper-cuts / PR #227",
          pattern: "PR #227",
          query: "PR #227",
        },
      ],
      more: {
        evidence: {
          queries: ["PR #227", "paper-cuts"],
        },
      },
    });
    expect(result.debug).toMatchObject({
      input: {
        query: "use agent-session-search to find PR 227 and papercuts branch",
        queries: ["PR #227", "paper-cuts"],
      },
    });
    expect(result.debug).not.toHaveProperty("ranking");
  });

  it("returns resolved source status and missing-root warnings", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const hermesRoot = join(tmp, "missing-hermes");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot, include: ["*.jsonl"] },
          { name: "hermes", path: hermesRoot, include: ["*"] },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search() {
            return { warnings: [], results: [] };
          },
        };
      },
    });
    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["codex", "hermes"],
    });

    expect(result).toMatchObject({
      query: "auth token timeout",
      expandedPatterns: AUTH_TOKEN_TIMEOUT_PATTERNS,
      searchedSources: [
        {
          name: "codex",
          root: await realpath(codexRoot),
          status: "ok",
        },
        {
          name: "hermes",
          root: hermesRoot,
          status: "missing",
          warning: `Configured root does not exist: ${hermesRoot}`,
        },
      ],
      warnings: [
        {
          source: "hermes",
          root: hermesRoot,
          code: "missing_root",
          message: `Configured root does not exist: ${hermesRoot}`,
          recommendedAction:
            "Create the directory, update or disable this source in the agent-session-search config, or run `agent-session-search sources --json` to inspect configured roots.",
        },
      ],
      results: [],
    });
  });

  it("keeps root warnings before source warnings in configured source order", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const missingRoot = join(tmp, "missing");
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "hermes", path: missingRoot },
          { name: "codex", path: codexRoot },
          { name: "claude", path: claudeRoot },
        ],
      })
    );

    let claudeStarted!: () => void;
    const claudeStartedPromise = new Promise<void>((resolve) => {
      claudeStarted = resolve;
    });
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search() {
            if (source.name === "codex") {
              await claudeStartedPromise;
            } else {
              claudeStarted();
            }
            return {
              warnings: [
                {
                  source: source.name,
                  root: source.root,
                  code: `${source.name}_warning`,
                  message: `${source.name} warning`,
                },
              ],
              results: [],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalClaudeRoot = await realpath(claudeRoot);

    expect(result.warnings).toEqual([
      {
        source: "hermes",
        root: missingRoot,
        code: "missing_root",
        message: `Configured root does not exist: ${missingRoot}`,
        recommendedAction:
          "Create the directory, update or disable this source in the agent-session-search config, or run `agent-session-search sources --json` to inspect configured roots.",
      },
      {
        source: "codex",
        root: canonicalCodexRoot,
        code: "codex_warning",
        message: "codex warning",
      },
      {
        source: "claude",
        root: canonicalClaudeRoot,
        code: "claude_warning",
        message: "claude warning",
      },
    ]);
  });

  it("warns when requested sources do not select any enabled configured root", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot, include: ["*.jsonl"] }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        throw new Error("backend should not be created");
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["codx"],
    });

    expect(result.searchedSources).toEqual([]);
    expect(result.warnings).toEqual([
      {
        source: "codx",
        code: "unknown_source",
        message:
          "Requested source is not configured or is disabled: codx. Did you mean codex? Enabled sources: codex. Run `agent-session-search sources --json` to inspect configured source names, use `--source codex`, or omit --source to search all enabled sources.",
        recommendedAction:
          "Use `--source codex`, run `agent-session-search sources --json`, or omit --source to search all enabled sources.",
      },
      {
        code: "no_sources_selected",
        message:
          "No enabled configured sources matched the requested source filter. Enabled sources: codex. Omit --source or choose one of the enabled sources.",
        recommendedAction:
          "Omit --source to search all enabled sources, or run `agent-session-search sources --json` and retry with one enabled source name.",
      },
    ]);
    expect(result.results).toEqual([]);
  });

  it("reports a backend failure for one source while keeping successful source hits", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot },
          { name: "claude", path: claudeRoot },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            if (source.name === "claude") {
              throw new Error("backend unavailable");
            }
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "session.jsonl"),
                  line: 3,
                  content: `matched ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["codex", "claude"],
      resultsDisplayMode: "evidence",
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalClaudeRoot = await realpath(claudeRoot);

    expect(result.searchedSources).toEqual([
      {
        name: "codex",
        root: canonicalCodexRoot,
        status: "ok",
      },
      {
        name: "claude",
        root: canonicalClaudeRoot,
        status: "failed",
        warning: "Search failed for source claude: backend unavailable",
      },
    ]);
    expect(result.warnings).toEqual([
      {
        source: "claude",
        root: canonicalClaudeRoot,
        code: "source_search_failed",
        message: "Search failed for source claude: backend unavailable",
      },
    ]);
    expect(result.results).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: join(canonicalCodexRoot, "session.jsonl"),
        hitCount: 1,
        matchedQueries: ["auth token timeout"],
        matchedPatterns: ["auth token timeout"],
        snippets: [
          {
            line: 3,
            content: "matched auth token timeout",
            pattern: "auth token timeout",
            query: "auth token timeout",
          },
        ],
        more: {
          evidence: {
            query: "auth token timeout",
            sources: ["codex"],
            resultsDisplayMode: "evidence",
            paths: [join(canonicalCodexRoot, "session.jsonl")],
          },
        },
      },
    ]);
  });

  it("does not report cleanup failure when backend creation fails", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot },
          { name: "claude", path: claudeRoot },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        if (source.name === "codex") {
          throw new Error("could not start backend");
        }
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "session.jsonl"),
                  line: 3,
                  content: `matched ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["codex", "claude"],
      resultsDisplayMode: "evidence",
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalClaudeRoot = await realpath(claudeRoot);

    expect(result.searchedSources).toEqual([
      {
        name: "codex",
        root: canonicalCodexRoot,
        status: "failed",
        warning: "Search failed for source codex: could not start backend",
      },
      {
        name: "claude",
        root: canonicalClaudeRoot,
        status: "ok",
      },
    ]);
    expect(result.warnings).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        code: "source_search_failed",
        message: "Search failed for source codex: could not start backend",
      },
    ]);
    expect(result.results).toEqual([
      {
        source: "claude",
        root: canonicalClaudeRoot,
        path: join(canonicalClaudeRoot, "session.jsonl"),
        hitCount: 1,
        matchedQueries: ["auth token timeout"],
        matchedPatterns: ["auth token timeout"],
        snippets: [
          {
            line: 3,
            content: "matched auth token timeout",
            pattern: "auth token timeout",
            query: "auth token timeout",
          },
        ],
        more: {
          evidence: {
            query: "auth token timeout",
            sources: ["claude"],
            resultsDisplayMode: "evidence",
            paths: [join(canonicalClaudeRoot, "session.jsonl")],
          },
        },
      },
    ]);
  });

  it("keeps successful hits when custom backend cleanup fails", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "session.jsonl"),
                  line: 3,
                  content: `matched ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
          async close() {
            throw new Error("cleanup socket closed");
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
    });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(result.searchedSources).toEqual([
      {
        name: "codex",
        root: canonicalCodexRoot,
        status: "ok",
      },
    ]);
    expect(candidateLeads(result)).toMatchObject([
      {
        source: "codex",
        root: canonicalCodexRoot,
        path: join(canonicalCodexRoot, "session.jsonl"),
        line: 3,
        preview: "matched auth token timeout",
        hitCount: 1,
        matchedQueries: ["auth token timeout"],
        matchedPatterns: ["auth token timeout"],
        more: {
          evidence: {
            query: "auth token timeout",
            sources: ["codex"],
            resultsDisplayMode: "evidence",
            paths: [join(canonicalCodexRoot, "session.jsonl")],
          },
        },
      },
    ]);
    expect(result.warnings).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        code: "source_cleanup_failed",
        message: "Cleanup failed for source codex: cleanup socket closed",
      },
    ]);
  });

  it("keeps successful hits when cleanup error stringification fails", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "session.jsonl"),
                  line: 3,
                  content: `matched ${input.patterns[0]}`,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
          async close() {
            throw {
              toString() {
                throw new Error("stringify exploded");
              },
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
    });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(result.searchedSources).toEqual([
      {
        name: "codex",
        root: canonicalCodexRoot,
        status: "ok",
      },
    ]);
    expect(result.results).toHaveLength(1);
    expect(result.warnings).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        code: "source_cleanup_failed",
        message: "Cleanup failed for source codex: Unknown error",
      },
    ]);
  });

  it("reports cleanup evidence without replacing the original search failure", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search() {
            throw new Error("grep unavailable");
          },
          async close() {
            throw new Error("cleanup socket closed");
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
    });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(result.results).toEqual([]);
    expect(result.searchedSources).toEqual([
      {
        name: "codex",
        root: canonicalCodexRoot,
        status: "failed",
        warning: "Search failed for source codex: grep unavailable",
      },
    ]);
    expect(result.warnings).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        code: "source_search_failed",
        message: "Search failed for source codex: grep unavailable",
      },
      {
        source: "codex",
        root: canonicalCodexRoot,
        code: "source_cleanup_failed",
        message: "Cleanup failed for source codex: cleanup socket closed",
      },
      {
        code: "all_sources_failed",
        message: `All searchable sources failed. Fallback command: rg --line-number --fixed-strings 'auth token timeout' '${canonicalCodexRoot}'`,
        recommendedAction: ALL_SOURCES_FAILED_RECOMMENDED_ACTION,
      },
    ]);
  });

  it("adds an all-sources-failed warning when every searchable source fails", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const claudeRoot = join(tmp, "claude");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await mkdir(claudeRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [
          { name: "codex", path: codexRoot },
          { name: "claude", path: claudeRoot },
        ],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search() {
            throw new Error(`${source.name} backend unavailable`);
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      sources: ["codex", "claude"],
    });
    const canonicalCodexRoot = await realpath(codexRoot);
    const canonicalClaudeRoot = await realpath(claudeRoot);

    expect(result.results).toEqual([]);
    expect(result.searchedSources).toEqual([
      {
        name: "codex",
        root: canonicalCodexRoot,
        status: "failed",
        warning: "Search failed for source codex: codex backend unavailable",
      },
      {
        name: "claude",
        root: canonicalClaudeRoot,
        status: "failed",
        warning: "Search failed for source claude: claude backend unavailable",
      },
    ]);
    expect(result.warnings).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        code: "source_search_failed",
        message: "Search failed for source codex: codex backend unavailable",
      },
      {
        source: "claude",
        root: canonicalClaudeRoot,
        code: "source_search_failed",
        message: "Search failed for source claude: claude backend unavailable",
      },
      {
        code: "all_sources_failed",
        message: `All searchable sources failed. Fallback command: rg --line-number --fixed-strings 'auth token timeout' '${canonicalCodexRoot}' '${canonicalClaudeRoot}'`,
        recommendedAction: ALL_SOURCES_FAILED_RECOMMENDED_ACTION,
      },
    ]);
  });

  it("passes search options to backends, caps per-source results, and includes debug details", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push(input);
            return {
              warnings: [],
              results: [1, 2, 3].map((line) => ({
                source: source.name,
                root: source.root,
                path: join(source.root, "session.jsonl"),
                line,
                content: `match ${line}`,
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      maxPatterns: 3,
      maxResultsPerSource: 2,
      context: 4,
      debug: true,
    });

    expect(calls).toEqual([
      {
        patterns: AUTH_TOKEN_TIMEOUT_PATTERNS_MAX_3,
        maxResults: 2,
        context: 4,
      },
    ]);
    expect(result.expandedPatterns).toEqual(AUTH_TOKEN_TIMEOUT_PATTERNS_MAX_3);
    expect(result.resultsDisplayMode).toBe("debug");
    expect(result.resultsShape).toBe("evidence_hits");
    expect(result.results).toMatchObject([{ line: 1 }, { line: 2 }]);
    expect(result.debug).toEqual({
      input: {
        query: "auth token timeout",
        maxPatterns: 3,
        maxResultsPerSource: 2,
        context: 4,
        debug: true,
      },
      expandedPatterns: AUTH_TOKEN_TIMEOUT_PATTERNS_MAX_3,
    });
  });

  it("caps unscoped evidence searches by default", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push(input);
            return {
              warnings: [],
              results: Array.from({ length: 25 }, (_, index) => ({
                source: source.name,
                root: source.root,
                path: join(source.root, "session.jsonl"),
                line: index + 1,
                content: `match ${index + 1}`,
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
    });

    expect(calls).toEqual([
      {
        patterns: AUTH_TOKEN_TIMEOUT_PATTERNS,
        maxResults: 20,
        context: undefined,
      },
    ]);
    expect(result.resultsDisplayMode).toBe("evidence");
    expect(result.resultsShape).toBe("evidence_groups");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      hitCount: 20,
      snippets: [
        { line: 1, content: "match 1" },
        { line: 2, content: "match 2" },
        { line: 3, content: "match 3" },
      ],
    });
    expect(result.warnings).toEqual([
      {
        code: "broad_evidence_capped",
        message:
          "Unscoped evidence searches are capped at 20 results per source. Use candidates first, then pass a candidate more.evidence payload or --path for focused evidence.",
        recommendedAction: BROAD_EVIDENCE_CAPPED_RECOMMENDED_ACTION,
      },
    ]);
  });

  it("returns an empty evidence-groups envelope for successful unscoped evidence with no hits", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search(input) {
            calls.push(input);
            return {
              warnings: [],
              results: [],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "nothing should match this",
      resultsDisplayMode: "evidence",
    });

    expect(calls).toEqual([
      {
        patterns: NOTHING_SHOULD_MATCH_PATTERNS,
        maxResults: 20,
        context: undefined,
      },
    ]);
    expect(result.resultsDisplayMode).toBe("evidence");
    expect(result.resultsShape).toBe("evidence_groups");
    expect(result.results).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("uses validated config defaults when request options are omitted", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
        defaults: {
          maxPatterns: 2,
          maxResultsPerSource: 1,
          context: 3,
        },
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            calls.push(input);
            return {
              warnings: [],
              results: [1, 2].map((line) => ({
                source: source.name,
                root: source.root,
                path: join(source.root, `${line}.jsonl`),
                line,
                content: `match ${line}`,
                pattern: input.patterns[0],
              })),
            };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: 'Find "auth token timeout" near parseSearchSessionsInput',
      resultsDisplayMode: "evidence",
    });

    expect(calls).toEqual([
      {
        patterns: ["auth token timeout", "parseSearchSessionsInput"],
        maxResults: 1,
        context: 3,
      },
    ]);
    expect(result.expandedPatterns).toEqual([
      "auth token timeout",
      "parseSearchSessionsInput",
    ]);
    expect(result.results).toHaveLength(1);
  });

  it("caps evidence content and candidate previews", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );
    const longContent = "x".repeat(9_000);

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search(input) {
            return {
              warnings: [],
              results: [
                {
                  source: source.name,
                  root: source.root,
                  path: join(source.root, "session.jsonl"),
                  line: 1,
                  content: longContent,
                  pattern: input.patterns[0],
                },
              ],
            };
          },
        };
      },
    });
    const canonicalCodexRoot = await realpath(codexRoot);

    const evidence = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "evidence",
      paths: [join(canonicalCodexRoot, "session.jsonl")],
    });
    const candidates = await search.searchSessions({
      query: "auth token timeout",
    });

    expect(evidence.results[0]).toMatchObject({
      content: `${"x".repeat(8_189)}...`,
    });
    expect(candidateLeads(candidates)[0]).toMatchObject({
      preview: `${"x".repeat(497)}...`,
    });
  });

  it("includes debug details when requested through resultsDisplayMode", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search() {
            return { warnings: [], results: [] };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "auth token timeout",
      resultsDisplayMode: "debug",
    });

    expect(result.resultsDisplayMode).toBe("debug");
    expect(result.resultsShape).toBe("evidence_hits");
    expect(result.debug).toEqual({
      input: {
        query: "auth token timeout",
        resultsDisplayMode: "debug",
      },
      expandedPatterns: AUTH_TOKEN_TIMEOUT_PATTERNS,
    });
  });

  it("rewrites natural-language queries into capped literal backend patterns", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search(input) {
            calls.push(input);
            return { warnings: [], results: [] };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query:
        'Find the bug in "auth token timeout" around src/search.ts for bd-iwz code thing',
      maxPatterns: 3,
    });

    expect(result.expandedPatterns).toEqual([
      "auth token timeout",
      "src/search.ts",
      "bd-iwz",
    ]);
    expect(calls).toEqual([
      {
        patterns: ["auth token timeout", "src/search.ts", "bd-iwz"],
        maxResults: undefined,
        context: undefined,
      },
    ]);
  });

  it("applies configured synonyms when rewriting search patterns", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
        synonyms: {
          auth: ["auth", "authentication", "login"],
          timeout: ["timeout", "deadline"],
        },
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search(input) {
            calls.push(input);
            return { warnings: [], results: [] };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query: "Find the auth timeout problem",
      maxPatterns: 4,
    });

    expect(result.expandedPatterns).toEqual([
      "auth",
      "authentication",
      "login",
      "timeout",
    ]);
    expect(calls).toEqual([
      {
        patterns: ["auth", "authentication", "login", "timeout"],
        maxResults: undefined,
        context: undefined,
      },
    ]);
  });

  it("preserves commands and emits obvious symbol naming variants", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const calls: unknown[] = [];
    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend() {
        return {
          async search(input) {
            calls.push(input);
            return { warnings: [], results: [] };
          },
        };
      },
    });

    const result = await search.searchSessions({
      query:
        "Run `npm test -- test/search.test.ts` near parseSearchSessionsInput",
      maxPatterns: 5,
    });

    expect(result.expandedPatterns).toEqual([
      "npm test -- test/search.test.ts",
      "test/search.test.ts",
      "parseSearchSessionsInput",
      "parse_search_sessions_input",
      "parse-search-sessions-input",
    ]);
    expect(calls).toEqual([
      {
        patterns: [
          "npm test -- test/search.test.ts",
          "test/search.test.ts",
          "parseSearchSessionsInput",
          "parse_search_sessions_input",
          "parse-search-sessions-input",
        ],
        maxResults: undefined,
        context: undefined,
      },
    ]);
  });

  it("treats backend error warnings without hits as source failures", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agent-session-search-"));
    const codexRoot = join(tmp, "codex");
    const configPath = join(tmp, "config.json");
    await mkdir(codexRoot);
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [{ name: "codex", path: codexRoot }],
      })
    );

    const search = createSessionSearch({
      configPath,
      defaultRoots: [],
      createBackend(source) {
        return {
          async search() {
            return {
              warnings: [
                {
                  source: source.name,
                  root: source.root,
                  code: "fff_backend_error",
                  message: "grep failed: index unavailable",
                },
              ],
              results: [],
            };
          },
        };
      },
    });

    const result = await search.searchSessions({ query: "auth token timeout" });
    const canonicalCodexRoot = await realpath(codexRoot);

    expect(result.searchedSources).toEqual([
      {
        name: "codex",
        root: canonicalCodexRoot,
        status: "failed",
        warning: "grep failed: index unavailable",
      },
    ]);
    expect(result.warnings).toEqual([
      {
        source: "codex",
        root: canonicalCodexRoot,
        code: "fff_backend_error",
        message: "grep failed: index unavailable",
      },
      {
        code: "all_sources_failed",
        message: `All searchable sources failed. Fallback command: rg --line-number --fixed-strings 'auth token timeout' '${canonicalCodexRoot}'`,
        recommendedAction: ALL_SOURCES_FAILED_RECOMMENDED_ACTION,
      },
    ]);
  });
});
